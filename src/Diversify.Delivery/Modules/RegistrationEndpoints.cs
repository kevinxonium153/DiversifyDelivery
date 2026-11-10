using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json;
using Diversify.Delivery.Core;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

namespace Diversify.Delivery.Modules;

// Suscripción mensual del cliente (US$5 por mes; ver Subscriptions en Loyalty.cs). Cada pago aprobado suma un mes,
// también si se paga por adelantado. Dos formas de pago:
//  - Tarjeta con PixelPay (ver PixelPay.cs). La app NUNCA recibe datos de tarjeta: el cliente paga en el checkout
//    de PixelPay (Hosted Payment) y aquí solo se verifica el resultado (regreso del cliente y aviso de PixelPay).
//    En desarrollo, sin PixelPay configurado, hay una pasarela simulada (Payments:Simulated=true) que aprueba al
//    instante. En producción la app no arranca con ella.
//  - Transferencia/depósito: el cliente escribe el número de referencia y el master lo aprueba al verlo en el banco.

public record TransferInput(string Reference);
public record ReviewInput(string? Notes);
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

    /// <summary>Monto que se cobra en PixelPay, en la moneda del comercio.</summary>
    private static decimal ExpectedAmount(RegistrationPayment p, PixelPayService pixel) => pixel.Currency == "USD" ? p.AmountUsd : p.AmountHnl;

    private static void Approve(RegistrationPayment p, string by, string note)
    {
        p.Status = RegistrationPaymentStatus.Aprobado;
        p.ReviewedBy = by;
        p.ReviewedAt = DateTime.Now;
        p.Notes = note;
        Subscriptions.Extend(p.User!, DateTime.Now);
    }

    /// <summary>
    /// Se puede pagar por adelantado solo el mes siguiente: si a la suscripción le quedan más días que esto, ya está
    /// pagado (evita cobros repetidos por error).
    /// </summary>
    private static readonly TimeSpan MaxPrepaid = TimeSpan.FromDays(35);

    private static void EnsureCanPay(User user)
    {
        AppException.ThrowIf(user.Status == AccountStatus.EnRevision, "Ya tienes un pago en revisión. Espera la confirmación.");
        AppException.ThrowIf(user.SubscriptionEndsAt > DateTime.Now.Add(MaxPrepaid),
            $"Ya pagaste el mes siguiente: tu suscripción está pagada hasta el {user.SubscriptionEndsAt:dd/MM/yyyy}.");
    }

    public static void Map(RouteGroupBuilder api)
    {
        var reg = api.MapGroup("/registration").RequireRoles(Roles.Customer);

        reg.MapGet("/", async (ClaimsPrincipal me, DeliveryDbContext db, PixelPayService pixel, IConfiguration config) =>
        {
            var s = await db.Settings.OrderBy(x => x.Id).FirstAsync();
            var user = await db.Users.FindAsync(me.UserId());
            if (Subscriptions.ExpireIfDue(user!, DateTime.Now)) await db.SaveChangesAsync();
            var last = await db.RegistrationPayments.Where(p => p.UserId == me.UserId() && p.Status != RegistrationPaymentStatus.Pendiente)
                .OrderByDescending(p => p.Id).FirstOrDefaultAsync();
            var provider = CardProvider(pixel, config);
            return new
            {
                status = user!.Status.ToString(),
                subscriptionEndsAt = user.SubscriptionEndsAt,
                canPayAhead = user.Status == AccountStatus.Activo && !(user.SubscriptionEndsAt > DateTime.Now.Add(MaxPrepaid)),
                feeUsd = s.RegistrationFeeUsd,
                feeHnl = Money.Round(s.RegistrationFeeUsd * s.ExchangeRate),
                exchangeRate = s.ExchangeRate,
                bankInstructions = s.BankInstructions,
                card = new
                {
                    enabled = provider is not null,
                    provider,
                    currency = provider == "pixelpay" ? pixel.Currency : "USD",
                    name = provider == "pixelpay" ? (pixel.Sandbox ? "PixelPay (sandbox)" : "PixelPay") : "Pasarela de prueba",
                },
                lastPayment = last is null ? null : new { last.Method, status = last.Status.ToString(), last.Reference, last.Notes, last.CreatedAt },
            };
        });

        // Inicia el pago con tarjeta. Simulada: aprueba. PixelPay: crea el cobro y devuelve la URL de su checkout.
        reg.MapPost("/card", async (ClaimsPrincipal me, DeliveryDbContext db, PixelPayService pixel, IConfiguration config, IMemoryCache cache,
            HttpContext http, CancellationToken ct) =>
        {
            var provider = CardProvider(pixel, config);
            AppException.ThrowIf(provider is null, "El pago con tarjeta aún no está disponible. Usa transferencia.");
            var user = await db.Users.FindAsync([me.UserId()], ct) ?? throw AppException.NotFound("Usuario");
            EnsureCanPay(user);
            var s = await db.Settings.OrderBy(x => x.Id).FirstAsync(ct);
            var hnl = Money.Round(s.RegistrationFeeUsd * s.ExchangeRate);

            if (provider == "simulado")
            {
                db.RegistrationPayments.Add(new RegistrationPayment
                {
                    UserId = user.Id, Method = "Tarjeta", AmountUsd = s.RegistrationFeeUsd, AmountHnl = hnl,
                    GatewayId = $"SIM-{DateTime.Now:yyMMddHHmmss}-{user.Id}", Status = RegistrationPaymentStatus.Aprobado,
                    ReviewedBy = "Pasarela de prueba", ReviewedAt = DateTime.Now,
                });
                Subscriptions.Extend(user, DateTime.Now);
                await db.SaveChangesAsync(ct);
                cache.Remove(SecurityExtensions.SessionCacheKey(user.Id));
                return Results.Ok(new { provider, approved = true, status = user.Status.ToString(), subscriptionEndsAt = user.SubscriptionEndsAt });
            }

            AppException.ThrowIf(string.IsNullOrWhiteSpace(user.Email), "Agrega tu correo en Mi cuenta para pagar con tarjeta.");
            // Un número de orden propio por intento (PixelPay no acepta repetidos).
            var payment = new RegistrationPayment
            {
                UserId = user.Id, Method = "Tarjeta", AmountUsd = s.RegistrationFeeUsd, AmountHnl = hnl, Status = RegistrationPaymentStatus.Pendiente,
                OrderId = $"SUS-{user.Id}-{DateTime.Now:yyMMddHHmmss}-{RandomNumberGenerator.GetHexString(4)}",
            };
            db.RegistrationPayments.Add(payment);
            await db.SaveChangesAsync(ct);

            var site = HostingSecurity.PublicBaseUrl(config, http);
            var title = $"Suscripción mensual {s.StoreName}";
            try
            {
                var url = await pixel.CreateCheckoutAsync(new HostedOrder(payment.OrderId, ExpectedAmount(payment, pixel),
                    title.Length > 60 ? title[..60] : title, user.FullName, user.Email!, user.Phone,
                    CompleteUrl: $"{site}/api/pixelpay/registro/{payment.Id}/completo",
                    CancelUrl: $"{site}/api/pixelpay/registro/{payment.Id}/cancelado",
                    CallbackUrl: $"{site}/api/pixelpay/aviso"), ct);
                return Results.Ok(new { provider, approved = false, checkoutUrl = url });
            }
            catch (AppException)
            {
                db.RegistrationPayments.Remove(payment); // no llegó a PixelPay: no queda nada pendiente
                await db.SaveChangesAsync(CancellationToken.None);
                throw;
            }
        }).RequireRateLimiting(HostingSecurity.PublicLimit);

        reg.MapPost("/transfer", async (TransferInput input, ClaimsPrincipal me, DeliveryDbContext db, IMemoryCache cache) =>
        {
            var reference = Text.Required(input.Reference, 80, "El número de referencia");
            var user = await db.Users.FindAsync(me.UserId()) ?? throw AppException.NotFound("Usuario");
            EnsureCanPay(user);
            AppException.ThrowIf(await db.RegistrationPayments.AnyAsync(p => p.UserId == user.Id && p.Status == RegistrationPaymentStatus.EnRevision),
                "Ya tienes una transferencia en revisión. Espera la confirmación.");
            AppException.ThrowIf(await db.RegistrationPayments.AnyAsync(p => p.Reference == reference && p.Status != RegistrationPaymentStatus.Rechazado),
                "Esa referencia ya fue registrada.");
            var s = await db.Settings.OrderBy(x => x.Id).FirstAsync();
            db.RegistrationPayments.Add(new RegistrationPayment
            {
                UserId = user.Id, Method = "Transferencia", AmountUsd = s.RegistrationFeeUsd, AmountHnl = Money.Round(s.RegistrationFeeUsd * s.ExchangeRate),
                Reference = reference, Status = RegistrationPaymentStatus.EnRevision,
            });
            // Si ya tiene la suscripción vigente (pago por adelantado), sigue pidiendo mientras se revisa.
            if (user.Status != AccountStatus.Activo) user.Status = AccountStatus.EnRevision;
            await db.SaveChangesAsync();
            cache.Remove(SecurityExtensions.SessionCacheKey(user.Id));
            return new { status = user.Status.ToString() };
        });

        // ---------- Regreso del checkout y aviso de PixelPay (sin sesión: los valida payment_hash) ----------
        var pixelpay = api.MapGroup("/pixelpay").RequireRateLimiting(HostingSecurity.PublicLimit);

        // _complete: PixelPay devuelve aquí al cliente cuando el pago se aprobó, con ?paymentHash=…
        pixelpay.MapGet("/registro/{id:int}/completo", async (int id, string? paymentHash, DeliveryDbContext db, PixelPayService pixel,
            IMemoryCache cache, ILogger<PixelPayService> log, CancellationToken ct) =>
        {
            var p = await db.RegistrationPayments.Include(x => x.User).FirstOrDefaultAsync(x => x.Id == id, ct);
            if (p?.OrderId is null) return Results.Redirect("/#/inscripcion/error");
            if (p.Status == RegistrationPaymentStatus.Pendiente)
            {
                if (!pixel.VerifyHash(p.OrderId, paymentHash))
                {
                    log.LogWarning("Regreso de PixelPay con paymentHash inválido para la orden {Order}", p.OrderId);
                    return Results.Redirect("/#/inscripcion/error");
                }
                Approve(p, "PixelPay", "Aprobado por PixelPay.");
                await db.SaveChangesAsync(ct);
                cache.Remove(SecurityExtensions.SessionCacheKey(p.UserId));
            }
            return Results.Redirect(p.Status switch
            {
                RegistrationPaymentStatus.Aprobado => "/#/inscripcion/ok",
                RegistrationPaymentStatus.EnRevision => "/#/inscripcion",
                _ => "/#/inscripcion/error",
            });
        });

        // _cancel: el cliente tocó "cancelar y regresar". El pago queda pendiente (no se muestra) y puede reintentar.
        pixelpay.MapGet("/registro/{id:int}/cancelado", (int id) => Results.Redirect("/#/inscripcion/cancelado"));

        // _callback: PixelPay avisa servidor a servidor cada cobro pagado (reintenta 3 veces si no recibe 200).
        // Cubre al cliente que cierra la ventana justo después de pagar.
        pixelpay.MapPost("/aviso", async (HttpRequest req, DeliveryDbContext db, PixelPayService pixel, IMemoryCache cache,
            ILogger<PixelPayService> log, CancellationToken ct) =>
        {
            JsonDocument doc;
            try { doc = await JsonDocument.ParseAsync(req.Body, cancellationToken: ct); }
            catch (JsonException) { return Results.BadRequest(new { error = "JSON inválido." }); }
            using var _ = doc;
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return Results.BadRequest(new { error = "JSON inválido." });
            var orderId = PixelPayService.ReadString(root, "order");
            var p = orderId is null ? null : await db.RegistrationPayments.Include(x => x.User).FirstOrDefaultAsync(x => x.OrderId == orderId, ct);
            if (p is null) return Results.NotFound(new { error = "Orden desconocida." });
            if (!pixel.VerifyHash(p.OrderId!, PixelPayService.ReadString(root, "payment_hash")))
            {
                log.LogWarning("Aviso de PixelPay con payment_hash inválido para la orden {Order}", orderId);
                return Results.BadRequest(new { error = "payment_hash inválido." });
            }
            if (!string.Equals(PixelPayService.ReadString(root, "status"), "paid", StringComparison.OrdinalIgnoreCase))
                return Results.Ok(new { received = true });

            var uuid = PixelPayService.ReadString(root, "uuid");
            if (uuid is not null && uuid.Length <= 80) p.GatewayId ??= uuid;
            if (p.Status == RegistrationPaymentStatus.Pendiente)
            {
                var paid = PixelPayService.ReadDecimal(root, "amount");
                var currency = PixelPayService.ReadString(root, "currency");
                var expected = ExpectedAmount(p, pixel);
                if (paid is null || Math.Abs(paid.Value - expected) > 0.01m || (currency is not null && !currency.Equals(pixel.Currency, StringComparison.OrdinalIgnoreCase)))
                {
                    // Pagado, pero no por lo esperado: lo decide el master al verlo en el portal de PixelPay.
                    p.Status = RegistrationPaymentStatus.EnRevision;
                    if (p.User!.Status != AccountStatus.Activo && p.User.Status != AccountStatus.Suspendido) p.User.Status = AccountStatus.EnRevision;
                    p.Notes = $"PixelPay avisó un pago de {currency} {paid:N2}; se esperaba {pixel.Currency} {expected:N2}.";
                }
                else Approve(p, "PixelPay", "Aprobado por PixelPay (aviso del servidor).");
                cache.Remove(SecurityExtensions.SessionCacheKey(p.UserId));
            }
            await db.SaveChangesAsync(ct);
            return Results.Ok(new { received = true });
        }).WithMetadata(new PixelPayNotificationCsrfExemption());

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
            Subscriptions.Extend(p.User!, DateTime.Now);
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
