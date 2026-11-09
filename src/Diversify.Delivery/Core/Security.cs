using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

namespace Diversify.Delivery.Core;

public static class Roles
{
    /// <summary>Administra productos, precios, pedidos, clientes y repartidores.</summary>
    public const string Master = "master";
    /// <summary>Recibe pedidos con instrucciones y ubicación, y confirma la entrega.</summary>
    public const string Driver = "repartidor";
    /// <summary>Cliente final: compra en el catálogo en línea (con inscripción pagada).</summary>
    public const string Customer = "cliente";

    public static readonly string[] Staff = [Master, Driver];
    public static readonly string[] All = [Master, Driver, Customer];
}

public static class SecurityExtensions
{
    public const string FullNameClaim = "full_name";
    public const string StampClaim = "stamp";

    public static int UserId(this ClaimsPrincipal user) =>
        int.Parse(user.FindFirstValue(ClaimTypes.NameIdentifier)
                  ?? throw new AppException("Sesión inválida.", StatusCodes.Status401Unauthorized));

    public static string DisplayName(this ClaimsPrincipal user) =>
        user.FindFirstValue(FullNameClaim) ?? user.Identity?.Name ?? "Sistema";

    /// <summary>Restringe un endpoint o grupo a uno o varios roles.</summary>
    public static TBuilder RequireRoles<TBuilder>(this TBuilder builder, params string[] roles)
        where TBuilder : IEndpointConventionBuilder =>
        builder.RequireAuthorization(new AuthorizeAttribute { Roles = string.Join(",", roles) });

    /// <summary>Huella de lo que hace válida una sesión: si cambia la contraseña, el rol o el estado, cambia.</summary>
    public static string Stamp(User u) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes($"{u.Id}|{u.Login}|{u.Role}|{u.Status}|{u.PasswordHash}")))[..16];

    public static string SessionCacheKey(int userId) => $"session:{userId}";

    /// <summary>
    /// Revisa en cada petición (caché de 30 s) que el usuario siga igual. Si el master lo suspende, le cambia la
    /// contraseña o aprueba su pago (cambia el estado), la sesión se renueva o se cierra.
    /// </summary>
    public static async Task ValidateSessionAsync(CookieValidatePrincipalContext ctx)
    {
        var principal = ctx.Principal;
        var stamp = principal?.FindFirstValue(StampClaim);
        if (principal is null || stamp is null || !int.TryParse(principal.FindFirstValue(ClaimTypes.NameIdentifier), out var userId))
        {
            ctx.RejectPrincipal();
            return;
        }
        var sp = ctx.HttpContext.RequestServices;
        var cache = sp.GetRequiredService<IMemoryCache>();
        var current = await cache.GetOrCreateAsync(SessionCacheKey(userId), async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(30);
            var db = sp.GetRequiredService<DeliveryDbContext>();
            var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId);
            return user is null || user.Status == AccountStatus.Suspendido ? "" : Stamp(user);
        });
        if (string.IsNullOrEmpty(current)) ctx.RejectPrincipal();
        else if (current != stamp)
        {
            // Cambió algo que no cierra la sesión (ej. pago aprobado): se renueva la cookie con los datos nuevos.
            var db = sp.GetRequiredService<DeliveryDbContext>();
            var user = await db.Users.AsNoTracking().FirstAsync(u => u.Id == userId);
            if (PasswordTag(user) != principal.FindFirstValue("pwd")) { ctx.RejectPrincipal(); return; }
            ctx.ReplacePrincipal(BuildPrincipal(user));
            ctx.ShouldRenew = true;
        }
    }

    /// <summary>Huella corta de la contraseña: si cambia, la sesión se cierra (no se puede renovar).</summary>
    private static string PasswordTag(User u) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(u.PasswordHash)))[..12];

    public static ClaimsPrincipal BuildPrincipal(User user)
    {
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new(ClaimTypes.Name, user.Login),
            new(ClaimTypes.Role, user.Role),
            new(FullNameClaim, user.FullName),
            new("status", user.Status.ToString()),
            new(StampClaim, Stamp(user)),
            new("pwd", PasswordTag(user)),
        };
        return new ClaimsPrincipal(new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme));
    }
}
