using System.Security.Claims;
using Diversify.Delivery.Core;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

namespace Diversify.Delivery.Modules;

// Inscripción del cliente ($5). Dos formas de pago:
//  - Tarjeta: pasarela en línea (IPaymentGateway). La app NUNCA recibe ni guarda datos de tarjeta: la pasarela
//    real (PixelPay, BAC, etc.) los pide en su propia página y avisa el resultado. Mientras no se contrate,
//    en desarrollo existe una pasarela simulada (Payments:Simulated=true) que aprueba al instante.
//  - Transferencia/depósito: el cliente escribe el número de referencia y el master lo aprueba al verlo en el banco.

public record TransferInput(string Reference);
public record ReviewInput(string? Notes);
public record RegistrationPaymentDto(int Id, int UserId, string Customer, string? Email, string? Phone, string Method,
    decimal AmountUsd, decimal AmountHnl, string? Reference, string? GatewayId, string Status, string? ReviewedBy, string? Notes,
    DateTime CreatedAt, DateTime? ReviewedAt);

/// <summary>Resultado de iniciar un cobro con tarjeta.</summary>
public record GatewayResult(bool Approved, string? TransactionId, string? RedirectUrl, string? Error);

public interface IPaymentGateway
{
    string Name { get; }
    bool Enabled { get; }
    /// <summary>Inicia el cobro. Una pasarela real devuelve RedirectUrl (su página de pago); la simulada aprueba.</summary>
    Task<GatewayResult> ChargeRegistrationAsync(User user, decimal amountHnl, decimal amountUsd);
}

/// <summary>Pasarela de prueba para desarrollo y demostraciones. En producción la app no arranca con ella.</summary>
public class SimulatedGateway(IConfiguration config) : IPaymentGateway
{
    public string Name => "Pasarela de prueba";
    public bool Enabled => config.GetValue("Payments:Simulated", false);

    public Task<GatewayResult> ChargeRegistrationAsync(User user, decimal amountHnl, decimal amountUsd) =>
        Task.FromResult(new GatewayResult(true, $"SIM-{DateTime.Now:yyMMddHHmmss}-{user.Id}", null, null));
}

public static class RegistrationEndpoints
{
    private static RegistrationPaymentDto ToDto(RegistrationPayment p) =>
        new(p.Id, p.UserId, p.User?.FullName ?? "", p.User?.Email, p.User?.Phone, p.Method, p.AmountUsd, p.AmountHnl, p.Reference,
            p.GatewayId, p.Status.ToString(), p.ReviewedBy, p.Notes, p.CreatedAt, p.ReviewedAt);

    public static void Map(RouteGroupBuilder api)
    {
        var reg = api.MapGroup("/registration").RequireRoles(Roles.Customer);

        reg.MapGet("/", async (ClaimsPrincipal me, DeliveryDbContext db, IPaymentGateway gateway) =>
        {
            var s = await db.Settings.OrderBy(x => x.Id).FirstAsync();
            var user = await db.Users.FindAsync(me.UserId());
            var last = await db.RegistrationPayments.Where(p => p.UserId == me.UserId()).OrderByDescending(p => p.Id).FirstOrDefaultAsync();
            return new
            {
                status = user!.Status.ToString(),
                feeUsd = s.RegistrationFeeUsd,
                feeHnl = Money.Round(s.RegistrationFeeUsd * s.ExchangeRate),
                exchangeRate = s.ExchangeRate,
                bankInstructions = s.BankInstructions,
                card = new { enabled = gateway.Enabled, name = gateway.Name },
                lastPayment = last is null ? null : new { last.Method, status = last.Status.ToString(), last.Reference, last.Notes, last.CreatedAt },
            };
        });

        reg.MapPost("/card", async (ClaimsPrincipal me, DeliveryDbContext db, IPaymentGateway gateway, IMemoryCache cache) =>
        {
            AppException.ThrowIf(!gateway.Enabled, "El pago con tarjeta aún no está disponible. Usa transferencia.");
            var user = await db.Users.FindAsync(me.UserId()) ?? throw AppException.NotFound("Usuario");
            AppException.ThrowIf(user.Status == AccountStatus.Activo, "Tu inscripción ya está pagada.");
            var s = await db.Settings.OrderBy(x => x.Id).FirstAsync();
            var hnl = Money.Round(s.RegistrationFeeUsd * s.ExchangeRate);
            var result = await gateway.ChargeRegistrationAsync(user, hnl, s.RegistrationFeeUsd);
            AppException.ThrowIf(!result.Approved && result.RedirectUrl is null, result.Error ?? "El pago fue rechazado.");

            var payment = new RegistrationPayment
            {
                UserId = user.Id, Method = "Tarjeta", AmountUsd = s.RegistrationFeeUsd, AmountHnl = hnl, GatewayId = result.TransactionId,
                Status = result.Approved ? RegistrationPaymentStatus.Aprobado : RegistrationPaymentStatus.Pendiente,
                ReviewedBy = result.Approved ? gateway.Name : null, ReviewedAt = result.Approved ? DateTime.Now : null,
            };
            db.RegistrationPayments.Add(payment);
            if (result.Approved) user.Status = AccountStatus.Activo;
            await db.SaveChangesAsync();
            cache.Remove(SecurityExtensions.SessionCacheKey(user.Id));
            return new { approved = result.Approved, redirectUrl = result.RedirectUrl, transactionId = result.TransactionId, status = user.Status.ToString() };
        });

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
