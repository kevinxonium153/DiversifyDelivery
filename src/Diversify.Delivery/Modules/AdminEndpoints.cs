using System.Security.Claims;
using Diversify.Delivery.Core;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

namespace Diversify.Delivery.Modules;

public record StaffInput(string Login, string FullName, string Role, string? Phone, string? Vehicle, string? Password, string Status = "Activo");
public record SettingsInput(string StoreName, string? StorePhone, string? StoreAddress, double? StoreLatitude, double? StoreLongitude,
    decimal DeliveryFee, decimal MinimumOrder, decimal FreeDeliveryFrom, decimal RegistrationFeeUsd, decimal ExchangeRate,
    string? BankInstructions, string OpensAt, string ClosesAt, bool AcceptingOrders, bool SyncPrices);

/// <summary>Usuarios (master y repartidores), clientes y ajustes de la tienda.</summary>
public static class AdminEndpoints
{
    public static void Map(RouteGroupBuilder api)
    {
        var g = api.MapGroup("/admin").RequireRoles(Roles.Master);

        g.MapGet("/users", async (DeliveryDbContext db, string? role) =>
        {
            var q = db.Users.AsNoTracking().Where(u => u.Role != Roles.Customer);
            if (!string.IsNullOrEmpty(role)) q = q.Where(u => u.Role == role);
            var list = await q.OrderBy(u => u.Role).ThenBy(u => u.FullName).ToListAsync();
            var active = await db.Orders.Where(o => o.DriverId != null && o.Status != OrderStatus.Entregado && o.Status != OrderStatus.Cancelado)
                .GroupBy(o => o.DriverId).Select(x => new { x.Key, n = x.Count() }).ToDictionaryAsync(x => x.Key!.Value, x => x.n);
            var today = DateTime.Today;
            var deliveredToday = await db.Orders.Where(o => o.DriverId != null && o.DeliveredAt >= today)
                .GroupBy(o => o.DriverId).Select(x => new { x.Key, n = x.Count() }).ToDictionaryAsync(x => x.Key!.Value, x => x.n);
            return list.Select(u => new
            {
                user = u.ToDto(),
                activeOrders = active.GetValueOrDefault(u.Id),
                deliveredToday = deliveredToday.GetValueOrDefault(u.Id),
            });
        });

        g.MapPost("/users", async (StaffInput input, DeliveryDbContext db, IPasswordHasher<User> hasher) =>
        {
            var u = new User();
            AppException.ThrowIf(string.IsNullOrEmpty(input.Password), "Indica una contraseña.");
            await ApplyStaffAsync(db, hasher, u, input);
            db.Users.Add(u);
            await db.SaveChangesAsync();
            return Results.Created($"/api/admin/users/{u.Id}", u.ToDto());
        });

        g.MapPut("/users/{id:int}", async (int id, StaffInput input, DeliveryDbContext db, IPasswordHasher<User> hasher, IMemoryCache cache, ClaimsPrincipal me) =>
        {
            var u = await db.Users.FirstOrDefaultAsync(x => x.Id == id && x.Role != Roles.Customer) ?? throw AppException.NotFound("Usuario");
            AppException.ThrowIf(u.Id == me.UserId() && (input.Role != Roles.Master || input.Status != "Activo"),
                "No puedes quitarte el rol master ni desactivarte a ti mismo.");
            await ApplyStaffAsync(db, hasher, u, input);
            await db.SaveChangesAsync();
            cache.Remove(SecurityExtensions.SessionCacheKey(u.Id));
            return u.ToDto();
        });

        // Clientes: estado de la inscripción y sus pedidos.
        g.MapGet("/customers", async (DeliveryDbContext db, string? status, string? search) =>
        {
            var q = db.Users.AsNoTracking().Where(u => u.Role == Roles.Customer);
            if (Enum.TryParse<AccountStatus>(status, true, out var st)) q = q.Where(u => u.Status == st);
            if (!string.IsNullOrWhiteSpace(search))
            {
                var s = search.Trim().ToLower();
                q = q.Where(u => u.FullName.ToLower().Contains(s) || u.Login.Contains(s) || (u.Phone ?? "").Contains(s));
            }
            var list = await q.OrderByDescending(u => u.Id).Take(500).ToListAsync();
            var ids = list.Select(u => u.Id).ToList();
            var stats = await db.Orders.Where(o => ids.Contains(o.CustomerId) && o.Status == OrderStatus.Entregado)
                .GroupBy(o => o.CustomerId).Select(x => new { x.Key, n = x.Count(), total = x.Sum(o => (double)o.Total) })
                .ToDictionaryAsync(x => x.Key);
            return list.Select(u => new
            {
                user = u.ToDto(),
                orders = stats.TryGetValue(u.Id, out var s) ? s.n : 0,
                spent = stats.TryGetValue(u.Id, out var s2) ? Money.Round((decimal)s2.total) : 0,
            });
        });

        g.MapPost("/customers/{id:int}/status", async (int id, StatusChange input, DeliveryDbContext db, IMemoryCache cache) =>
        {
            var u = await db.Users.FirstOrDefaultAsync(x => x.Id == id && x.Role == Roles.Customer) ?? throw AppException.NotFound("Cliente");
            AppException.ThrowIf(!Enum.TryParse<AccountStatus>(input.Status, true, out var st), "Estado inválido.");
            u.Status = st;
            await db.SaveChangesAsync();
            cache.Remove(SecurityExtensions.SessionCacheKey(u.Id));
            return u.ToDto();
        });

        g.MapGet("/settings", async (DeliveryDbContext db) => await db.Settings.AsNoTracking().OrderBy(x => x.Id).FirstAsync());

        g.MapPut("/settings", async (SettingsInput input, DeliveryDbContext db) =>
        {
            var s = await db.Settings.OrderBy(x => x.Id).FirstAsync();
            s.StoreName = Text.Required(input.StoreName, 120, "El nombre de la tienda");
            s.StorePhone = Text.Clean(input.StorePhone, 30);
            s.StoreAddress = Text.Clean(input.StoreAddress, 200);
            s.StoreLatitude = input.StoreLatitude;
            s.StoreLongitude = input.StoreLongitude;
            AppException.ThrowIf(input.DeliveryFee < 0 || input.MinimumOrder < 0 || input.FreeDeliveryFrom < 0, "Los montos no pueden ser negativos.");
            AppException.ThrowIf(input.RegistrationFeeUsd < 0 || input.ExchangeRate <= 0, "Revisa la inscripción y el tipo de cambio.");
            s.DeliveryFee = Money.Round(input.DeliveryFee);
            s.MinimumOrder = Money.Round(input.MinimumOrder);
            s.FreeDeliveryFrom = Money.Round(input.FreeDeliveryFrom);
            s.RegistrationFeeUsd = Money.Round(input.RegistrationFeeUsd);
            s.ExchangeRate = Math.Round(input.ExchangeRate, 4);
            s.BankInstructions = Text.Clean(input.BankInstructions, 500);
            AppException.ThrowIf(!TimeOnly.TryParse(input.OpensAt, out _) || !TimeOnly.TryParse(input.ClosesAt, out _), "El horario debe tener formato HH:MM.");
            s.OpensAt = input.OpensAt;
            s.ClosesAt = input.ClosesAt;
            s.AcceptingOrders = input.AcceptingOrders;
            s.SyncPrices = input.SyncPrices;
            await db.SaveChangesAsync();
            return s;
        });
    }

    public record StatusChange(string Status);

    private static async Task ApplyStaffAsync(DeliveryDbContext db, IPasswordHasher<User> hasher, User u, StaffInput input)
    {
        var login = Text.Required(input.Login, 120, "El usuario").ToLowerInvariant();
        AppException.ThrowIf(login.Any(char.IsWhiteSpace), "El usuario no puede tener espacios.");
        AppException.ThrowIf(await db.Users.AnyAsync(x => x.Login == login && x.Id != u.Id), "Ese usuario ya existe.");
        AppException.ThrowIf(input.Role is not (Roles.Master or Roles.Driver), "El rol debe ser master o repartidor.");
        AppException.ThrowIf(!Enum.TryParse<AccountStatus>(input.Status, true, out var st) || st is not (AccountStatus.Activo or AccountStatus.Suspendido),
            "El estado debe ser Activo o Suspendido.");
        u.Login = login;
        u.FullName = Text.Required(input.FullName, 120, "El nombre");
        u.Role = input.Role;
        u.Phone = Text.Clean(input.Phone, 30);
        u.Vehicle = input.Role == Roles.Driver ? Text.Clean(input.Vehicle, 60) : null;
        u.Status = st;
        if (!string.IsNullOrEmpty(input.Password))
        {
            AppException.ThrowIf(input.Password.Length < 8, "La contraseña debe tener al menos 8 caracteres.");
            u.PasswordHash = hasher.HashPassword(u, input.Password);
        }
    }
}
