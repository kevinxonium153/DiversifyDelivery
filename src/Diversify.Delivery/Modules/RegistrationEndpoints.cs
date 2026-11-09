using System.Security.Claims;
using System.Security.Cryptography;
using Diversify.Delivery.Core;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

namespace Diversify.Delivery.Modules;

// Inscripción del cliente (pago único de US$5). Dos formas de pago:
//  - Tarjeta con PixelPay (ver PixelPay.cs). La app NUNCA recibe datos de tarjeta: el SDK de PixelPay los cifra en
//    el navegador y los manda directo a PixelPay; aquí solo se verifica el resultado.
//    En desarrollo, sin PixelPay configurado, hay una pasarela simulada (Payments:Simulated=true) que aprueba al
//    instante. En producción la app no arranca con ella.
//  - Transferencia/depósito: el cliente escribe el número de referencia y el master lo aprueba al verlo en el banco.

public record TransferInput(string Reference);
public record ReviewInput(string? Notes);
public record CardConfirmInput(string PaymentUuid, string PaymentHash);
public record RegistrationPaymentDto(int Id, int UserId, string Customer, string? Email, string? Phone, string Method,
    decimal AmountUsd, decimal AmountHnl, string? Reference, string? GatewayId, string Status, string? ReviewedBy, string? Notes,
    DateTime CreatedAt, DateTime? ReviewedAt);

public static class RegistrationEndpoints
{
    private static RegistrationPaymentDto ToDto(RegistrationPayment p) =>
        new(p.Id, p.UserId, p.User?.FullName ?? "", p.User?.Email, p.User?.Phone, p.Method, p.AmountUsd, p.AmountHnl, p.Reference,
            p.GatewayId, p.Status.ToString(), p.ReviewedBy, p.Notes, p.CreatedAt, p.ReviewedAt);

    /// <summary>Qué pasarela de tarjeta está activa: PixelPay si está configurada; si no, la simulada (solo desarrollo).</summary>
    private static string? CardProvider(PixelPayService pixel, IConfiguration config) =>
        pixel.Configured ? "pixelpay" : config.GetValue("Payments:Simulated", false) ? "simulado" : null;

    public static void Map(RouteGroupBuilder api)
    {
        var reg = api.MapGroup("/registration").RequireRoles(Roles.Customer);

        reg.MapGet("/", async (ClaimsPrincipal me, DeliveryDbContext db, PixelPayService pixel, IConfiguration config) =>
        {
            var s = await db.Settings.OrderBy(x => x.Id).FirstAsync();
            var user = await db.Users.FindAsync(me.UserId());
            var last = await db.RegistrationPayments.Where(p => p.UserId == me.UserId() && p.Status != RegistrationPaymentStatus.Pendiente)
                .OrderByDescending(p => p.Id).FirstOrDefaultAsync();
            var provider = CardProvider(pixel, config);
            return new
            {
                status = user!.Status.ToString(),
                feeUsd = s.RegistrationFeeUsd,
                feeHnl = Money.Round(s.RegistrationFeeUsd * s.ExchangeRate),
                exchangeRate = s.ExchangeRate,
                bankInstructions = s.BankInstructions,
                card = new
                {
                    enabled = provider is not null,
                    provider,
                    name = provider == "pixelpay" ? (pixel.Sandbox ? "PixelPay (sandbox)" : "PixelPay") : "Pasarela de prueba",
                },
                lastPayment = last is null ? null : new { last.Method, status = last.Status.ToString(), last.Reference, last.Notes, last.CreatedAt },
            };
        });

        // Inicia el pago con tarjeta. Simulada: aprueba. PixelPay: crea el pago pendiente y manda a la página de pago.
        reg.MapPost("/card", async (ClaimsPrincipal me, DeliveryDbContext db, PixelPayService pixel, IConfiguration config, IMemoryCache cache) =>
        {
            var provider = CardProvider(pixel, config);
            AppException.ThrowIf(provider is null, "El pago con tarjeta aún no está disponible. Usa transferencia.");
            var user = await db.Users.FindAsync(me.UserId()) ?? throw AppException.NotFound("Usuario");
            AppException.ThrowIf(user.Status == AccountStatus.Activo, "Tu inscripción ya está pagada.");
            AppException.ThrowIf(user.Status == AccountStatus.EnRevision, "Ya tienes un pago en revisión. Espera la confirmación.");
            var s = await db.Settings.OrderBy(x => x.Id).FirstAsync();
            var hnl = Money.Round(s.RegistrationFeeUsd * s.ExchangeRate);

            if (provider == "simulado")
            {
                db.RegistrationPayments.Add(new RegistrationPayment
                {
                    UserId = user.Id, Method = "Tarjeta", AmountUsd = s.RegistrationFeeUsd, AmountHnl = hnl,
                    GatewayId = $"SIM-{DateTime.Now:yyMMddHHmmss}-{user.Id}", Status = RegistrationPaymentStatus.Aprobado,
                    ReviewedBy = "Pasarela de prueba", ReviewedAt = DateTime.Now,
                });
                user.Status = AccountStatus.Activo;
                await db.SaveChangesAsync();
                cache.Remove(SecurityExtensions.SessionCacheKey(user.Id));
                return Results.Ok(new { provider, approved = true, status = user.Status.ToString() });
            }

            // PixelPay: un pago pendiente con número de orden propio (no se repite aunque el cliente reintente).
            var payment = new RegistrationPayment
            {
                UserId = user.Id, Method = "Tarjeta", AmountUsd = s.RegistrationFeeUsd, AmountHnl = hnl, Status = RegistrationPaymentStatus.Pendiente,
                OrderId = $"INS-{user.Id}-{DateTime.Now:yyMMddHHmmss}-{RandomNumberGenerator.GetHexString(4)}",
            };
            db.RegistrationPayments.Add(payment);
            await db.SaveChangesAsync();
            return Results.Ok(new { provider, approved = false, checkoutUrl = $"/pago/?id={payment.Id}" });
        });

        // Datos que necesita el SDK de PixelPay en la página de pago. La llave secreta NUNCA se envía.
        reg.MapGet("/card/{id:int}", async (int id, ClaimsPrincipal me, DeliveryDbContext db, PixelPayService pixel) =>
        {
            AppException.ThrowIf(!pixel.Configured, "El pago con tarjeta no está disponible.");
            var p = await db.RegistrationPayments.Include(x => x.User).FirstOrDefaultAsync(x => x.Id == id && x.UserId == me.UserId())
                    ?? throw AppException.NotFound("Pago");
            AppException.ThrowIf(p.Status != RegistrationPaymentStatus.Pendiente || p.OrderId is null, "Este pago ya fue procesado.");
            var s = await db.Settings.OrderBy(x => x.Id).FirstAsync();
            return new
            {
                paymentId = p.Id, orderId = p.OrderId, currency = pixel.Currency,
                amount = pixel.Currency == "USD" ? p.AmountUsd : p.AmountHnl, amountUsd = p.AmountUsd, amountHnl = p.AmountHnl,
                endpoint = pixel.Endpoint, key = pixel.Key, hash = pixel.AuthHash, sandbox = pixel.Sandbox,
                customerName = p.User!.FullName, customerEmail = p.User.Email, customerPhone = p.User.Phone,
                storeName = s.StoreName,
            };
        });

        // El navegador reporta el resultado de PixelPay; aquí se verifica antes de activar la cuenta.
        reg.MapPost("/card/{id:int}/confirm", async (int id, CardConfirmInput input, ClaimsPrincipal me, DeliveryDbContext db,
            PixelPayService pixel, IMemoryCache cache, CancellationToken ct) =>
        {
            var p = await db.RegistrationPayments.Include(x => x.User).FirstOrDefaultAsync(x => x.Id == id && x.UserId == me.UserId(), ct)
                    ?? throw AppException.NotFound("Pago");
            AppException.ThrowIf(p.Status != RegistrationPaymentStatus.Pendiente || p.OrderId is null, "Este pago ya fue procesado.");
            var uuid = Text.Required(input.PaymentUuid, 80, "La transacción");
            AppException.ThrowIf(!pixel.VerifyHash(p.OrderId, input.PaymentHash), "No pudimos verificar el pago con PixelPay. No se activó la cuenta.");
            AppException.ThrowIf(await db.RegistrationPayments.AnyAsync(x => x.GatewayId == uuid && x.Id != p.Id, ct), "Esa transacción ya fue usada.");

            var status = await pixel.GetStatusAsync(uuid, pixel.Currency == "USD" ? p.AmountUsd : p.AmountHnl, ct);
            p.GatewayId = uuid;
            p.Notes = status.Message.Length > 300 ? status.Message[..300] : status.Message;
            switch (status.Verdict)
            {
                case PixelPayVerdict.Aprobado:
                    p.Status = RegistrationPaymentStatus.Aprobado;
                    p.ReviewedBy = "PixelPay";
                    p.ReviewedAt = DateTime.Now;
                    p.User!.Status = AccountStatus.Activo;
                    break;
                case PixelPayVerdict.Rechazado:
                    p.Status = RegistrationPaymentStatus.Rechazado;
                    p.ReviewedBy = "PixelPay";
                    p.ReviewedAt = DateTime.Now;
                    break;
                default:
                    // Cobro con hash válido pero sin confirmación del estado: el master lo revisa en el portal de PixelPay.
                    p.Status = RegistrationPaymentStatus.EnRevision;
                    p.User!.Status = AccountStatus.EnRevision;
                    break;
            }
            await db.SaveChangesAsync(ct);
            cache.Remove(SecurityExtensions.SessionCacheKey(p.UserId));
            return new { status = p.Status.ToString(), accountStatus = p.User!.Status.ToString(), message = status.Message };
        }).RequireRateLimiting(HostingSecurity.PublicLimit);

        reg.MapPost("/transfer", async (TransferInput input, ClaimsPrincipal me, DeliveryDbContext db, IMemoryCache cache) =>
        {
            var reference = Text.Required(input.Reference, 80, "El número de referencia");
            var user = await db.Users.FindAsync(me.UserId()) ?? throw AppException.NotFound("Usuario");
            AppException.ThrowIf(user.Status == AccountStatus.Activo, "Tu inscripción ya está pagada.");
            AppException.ThrowIf(await db.RegistrationPayments.AnyAsync(p => p.Reference == reference && p.Status != RegistrationPaymentStatus.Rechazado),
                "Esa referencia ya fue registrada.");
            var s = await db.Settings.OrderBy(x => x.Id).FirstAsync();
            db.RegistrationPayments.Add(new RegistrationPayment
            {
                UserId = user.Id, Method = "Transferencia", AmountUsd = s.RegistrationFeeUsd, AmountHnl = Money.Round(s.RegistrationFeeUsd * s.ExchangeRate),
                Reference = reference, Status = RegistrationPaymentStatus.EnRevision,
            });
            user.Status = AccountStatus.EnRevision;
            await db.SaveChangesAsync();
            cache.Remove(SecurityExtensions.SessionCacheKey(user.Id));
            return new { status = user.Status.ToString() };
        });

        // ---------- Master: revisar transferencias ----------
        var admin = api.MapGroup("/admin/registrations").RequireRoles(Roles.Master);

        admin.MapGet("/", async (DeliveryDbContext db, string? status) =>
        {
            var q = db.RegistrationPayments.Include(p => p.User).AsNoTracking();
            if (Enum.TryParse<RegistrationPaymentStatus>(status, true, out var st)) q = q.Where(p => p.Status == st);
            return (await q.OrderByDescending(p => p.Id).Take(300).ToListAsync()).Select(ToDto);
        });

        admin.MapPost("/{id:int}/approve", async (int id, ReviewInput input, ClaimsPrincipal me, DeliveryDbContext db, IMemoryCache cache) =>
        {
            var p = await db.RegistrationPayments.Include(x => x.User).FirstOrDefaultAsync(x => x.Id == id) ?? throw AppException.NotFound("Pago");
            AppException.ThrowIf(p.Status == RegistrationPaymentStatus.Aprobado, "Este pago ya fue aprobado.");
            p.Status = RegistrationPaymentStatus.Aprobado;
            p.ReviewedBy = me.DisplayName();
            p.ReviewedAt = DateTime.Now;
            p.Notes = Text.Clean(input.Notes, 300);
            p.User!.Status = AccountStatus.Activo;
            await db.SaveChangesAsync();
            cache.Remove(SecurityExtensions.SessionCacheKey(p.UserId));
            return ToDto(p);
        });

        admin.MapPost("/{id:int}/reject", async (int id, ReviewInput input, ClaimsPrincipal me, DeliveryDbContext db, IMemoryCache cache) =>
        {
            var p = await db.RegistrationPayments.Include(x => x.User).FirstOrDefaultAsync(x => x.Id == id) ?? throw AppException.NotFound("Pago");
            AppException.ThrowIf(p.Status == RegistrationPaymentStatus.Aprobado, "No se puede rechazar un pago aprobado.");
            p.Status = RegistrationPaymentStatus.Rechazado;
            p.ReviewedBy = me.DisplayName();
            p.ReviewedAt = DateTime.Now;
            p.Notes = Text.Clean(input.Notes, 300) ?? "No se encontró la transferencia.";
            if (p.User!.Status == AccountStatus.EnRevision) p.User.Status = AccountStatus.PendientePago;
            await db.SaveChangesAsync();
            cache.Remove(SecurityExtensions.SessionCacheKey(p.UserId));
            return ToDto(p);
        });
    }
}
