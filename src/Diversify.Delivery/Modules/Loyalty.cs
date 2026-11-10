using System.Security.Claims;
using System.Security.Cryptography;
using Diversify.Delivery.Core;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

namespace Diversify.Delivery.Modules;

// Puntos y referidos (1 punto = L 1). Ver notas/Decisiones/006.
//  - Compra: al entregarse un pedido, el cliente gana StoreSettings.PointsPercent (2 %) del total.
//  - Referido: si al cliente lo invitó otro cliente (código de referido al registrarse), quien lo invitó gana
//    StoreSettings.ReferralPercent (2 %) del total de cada pedido entregado del invitado. Un solo nivel.
// Los puntos se acreditan al ENTREGAR (no al pedir): un pedido cancelado no da puntos, y se usa el total final
// (con los ajustes de lo que no había). El índice único (OrderId, UserId, Kind) impide acreditar dos veces.
// Canjear puntos todavía no está disponible: por ahora el cliente ve su saldo y su equivalente en lempiras.

public static class Loyalty
{
    // Sin letras ni números que se confundan al dictarlo (0/O, 1/I/L).
    private const string CodeAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

    /// <summary>Acredita los puntos de un pedido que se acaba de entregar. Se guarda con el SaveChanges del pedido.</summary>
    public static async Task CreditDeliveredAsync(DeliveryDbContext db, Order o, CancellationToken ct = default)
    {
        if (await db.PointsEntries.AnyAsync(p => p.OrderId == o.Id, ct)) return;
        var s = await db.Settings.AsNoTracking().OrderBy(x => x.Id).FirstAsync(ct);
        var customer = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == o.CustomerId, ct);
        if (customer is null) return;

        var own = Money.Round(o.Total * s.PointsPercent / 100m);
        if (own > 0)
            db.PointsEntries.Add(new PointsEntry
            {
                UserId = customer.Id, Kind = PointsKind.Compra, Points = own, OrderId = o.Id,
                Description = $"Compra {o.Number} ({s.PointsPercent:0.##} % de L {o.Total:N2})",
            });

        if (customer.ReferredById is int referrerId)
        {
            var referrer = await db.Users.AsNoTracking().FirstOrDefaultAsync(u =>
                u.Id == referrerId && u.Role == Roles.Customer && u.Status != AccountStatus.Suspendido, ct);
            var bonus = Money.Round(o.Total * s.ReferralPercent / 100m);
            if (referrer is not null && bonus > 0)
                db.PointsEntries.Add(new PointsEntry
                {
                    UserId = referrer.Id, Kind = PointsKind.Referido, Points = bonus, OrderId = o.Id, FromUserId = customer.Id,
                    Description = $"Compra de tu invitado {FirstName(customer.FullName)} ({s.ReferralPercent:0.##} % de L {o.Total:N2})",
                });
        }
    }

    public static async Task<decimal> BalanceAsync(DeliveryDbContext db, int userId, CancellationToken ct = default) =>
        Money.Round((decimal)await db.PointsEntries.Where(p => p.UserId == userId).Select(p => (double)p.Points).SumAsync(ct));

    /// <summary>Código de referido nuevo y único (6 caracteres).</summary>
    public static async Task<string> NewCodeAsync(DeliveryDbContext db, CancellationToken ct = default)
    {
        while (true)
        {
            var code = string.Concat(Enumerable.Range(0, 6).Select(_ => CodeAlphabet[RandomNumberGenerator.GetInt32(CodeAlphabet.Length)]));
            if (!await db.Users.AnyAsync(u => u.ReferralCode == code, ct)) return code;
        }
    }

    public static string NormalizeCode(string? code) => (code ?? "").Trim().ToUpperInvariant();

    private static string FirstName(string fullName) => fullName.Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? "";

    public static void Map(RouteGroupBuilder api)
    {
        // Mis puntos: saldo, equivalente en lempiras, código para invitar y movimientos.
        api.MapGet("/points", async (ClaimsPrincipal me, DeliveryDbContext db, HttpContext http, IConfiguration config, CancellationToken ct) =>
        {
            var user = await db.Users.FirstOrDefaultAsync(u => u.Id == me.UserId(), ct) ?? throw AppException.NotFound("Usuario");
            if (user.ReferralCode is null) { user.ReferralCode = await NewCodeAsync(db, ct); await db.SaveChangesAsync(ct); }
            var s = await db.Settings.AsNoTracking().OrderBy(x => x.Id).FirstAsync(ct);
            var entries = await db.PointsEntries.AsNoTracking().Where(p => p.UserId == user.Id)
                .OrderByDescending(p => p.Id).Take(100).ToListAsync(ct);
            var balance = await BalanceAsync(db, user.Id, ct);
            var fromReferrals = Money.Round((decimal)await db.PointsEntries.Where(p => p.UserId == user.Id && p.Kind == PointsKind.Referido)
                .Select(p => (double)p.Points).SumAsync(ct));
            return new
            {
                balance,
                valueHnl = balance, // 1 punto = L 1
                pointsPercent = s.PointsPercent,
                referralPercent = s.ReferralPercent,
                referralCode = user.ReferralCode,
                referralLink = $"{HostingSecurity.PublicBaseUrl(config, http)}/#/registro?ref={user.ReferralCode}",
                referrals = await db.Users.CountAsync(u => u.ReferredById == user.Id, ct),
                fromReferrals,
                entries = entries.Select(p => new { kind = p.Kind.ToString(), p.Points, p.Description, p.CreatedAt }),
            };
        }).RequireRoles(Roles.Customer);
    }
}

// Suscripción mensual del cliente (US$5 por mes). Cada pago aprobado suma un mes: desde hoy, o desde que vence si
// paga por adelantado. Al vencer, la cuenta vuelve a "Pendiente de pago" y no puede pedir hasta renovar.
// El cobro todavía no es automático: el cliente renueva con tarjeta (PixelPay) o transferencia. Ver Decisión 006.
public static class Subscriptions
{
    public static bool IsCurrent(User u, DateTime now) => u.Status == AccountStatus.Activo && u.SubscriptionEndsAt > now;

    /// <summary>Suma un mes pagado. No reactiva a un cliente que el master suspendió.</summary>
    public static void Extend(User u, DateTime now)
    {
        var from = u.SubscriptionEndsAt > now ? u.SubscriptionEndsAt.Value : now;
        u.SubscriptionEndsAt = from.AddMonths(1);
        if (u.Status != AccountStatus.Suspendido) u.Status = AccountStatus.Activo;
    }

    /// <summary>Si la suscripción venció, pasa la cuenta a "Pendiente de pago". Devuelve true si cambió.</summary>
    public static bool ExpireIfDue(User u, DateTime now)
    {
        if (u.Role != Roles.Customer || u.Status != AccountStatus.Activo || u.SubscriptionEndsAt > now) return false;
        u.Status = AccountStatus.PendientePago;
        return true;
    }
}

/// <summary>Cada hora pasa a "Pendiente de pago" las suscripciones vencidas. Nunca detiene la app si falla.</summary>
public class SubscriptionExpiryWorker(IServiceScopeFactory scopes, ILogger<SubscriptionExpiryWorker> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromHours(1));
        do
        {
            try
            {
                using var scope = scopes.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<DeliveryDbContext>();
                var cache = scope.ServiceProvider.GetRequiredService<IMemoryCache>();
                var now = DateTime.Now;
                var due = await db.Users.Where(u => u.Role == Roles.Customer && u.Status == AccountStatus.Activo &&
                        (u.SubscriptionEndsAt == null || u.SubscriptionEndsAt <= now))
                    .Select(u => u.Id).ToListAsync(stoppingToken);
                if (due.Count > 0)
                {
                    await db.Users.Where(u => due.Contains(u.Id))
                        .ExecuteUpdateAsync(x => x.SetProperty(u => u.Status, AccountStatus.PendientePago), stoppingToken);
                    foreach (var id in due) cache.Remove(SecurityExtensions.SessionCacheKey(id));
                    log.LogInformation("Suscripciones vencidas: {Count} cuenta(s) pasaron a pendiente de pago", due.Count);
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogError(ex, "No se pudieron revisar las suscripciones vencidas");
            }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
