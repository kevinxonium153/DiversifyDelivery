using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Authentication;
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
    public const string SessionIdClaim = "session_id";
    public static readonly TimeSpan SessionLifetime = TimeSpan.FromDays(30);

    private static string SessionHash(string id) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(id)));

    /// <summary>Cada inicio de sesión explícito rota el identificador, también al cambiar el perfil o la contraseña.</summary>
    public static async Task SignInUserAsync(this HttpContext http, User user)
    {
        var db = http.RequestServices.GetRequiredService<DeliveryDbContext>();
        await http.RevokeSessionAsync();
        var now = DateTime.UtcNow;
        await db.UserSessions.Where(s => s.ExpiresAt <= now).ExecuteDeleteAsync();
        var id = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        db.UserSessions.Add(new UserSession { Id = SessionHash(id), UserId = user.Id, ExpiresAt = now.Add(SessionLifetime) });
        await db.SaveChangesAsync();
        await http.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, BuildPrincipal(user, id));
    }

    /// <summary>No usa caché: borrar la fila invalida todas las copias de esta sesión, incluso tras reiniciar.</summary>
    public static async Task RevokeSessionAsync(this HttpContext http)
    {
        var id = http.User.FindFirstValue(SessionIdClaim);
        if (id is null) return;
        var hash = SessionHash(id);
        var db = http.RequestServices.GetRequiredService<DeliveryDbContext>();
        await db.UserSessions.Where(s => s.Id == hash).ExecuteDeleteAsync();
    }

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
    /// Comprueba en cada petición la sesión en SQLite, sin caché. Revisa el usuario con caché de 30 s.
    /// Si el master lo suspende, le cambia la
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
        var sessionId = principal.FindFirstValue(SessionIdClaim);
        // Las cookies anteriores a esta protección deben iniciar sesión de nuevo.
        if (sessionId is null) { ctx.RejectPrincipal(); return; }
        var db = sp.GetRequiredService<DeliveryDbContext>();
        var hash = SessionHash(sessionId);
        var now = DateTime.UtcNow;
        var session = await db.UserSessions.AsNoTracking().FirstOrDefaultAsync(s => s.Id == hash && s.UserId == userId && s.ExpiresAt > now);
        if (session is null) { ctx.RejectPrincipal(); return; }
        var cache = sp.GetRequiredService<IMemoryCache>();
        var current = await cache.GetOrCreateAsync(SessionCacheKey(userId), async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(30);
            var user = await db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId);
            return user is null || user.Status == AccountStatus.Suspendido ? "" : Stamp(user);
        });
        if (string.IsNullOrEmpty(current)) { ctx.RejectPrincipal(); return; }
        else if (current != stamp)
        {
            // Cambió algo que no cierra la sesión (ej. pago aprobado): se renueva la cookie con los datos nuevos.
            var user = await db.Users.AsNoTracking().FirstAsync(u => u.Id == userId);
            if (PasswordTag(user) != principal.FindFirstValue("pwd")) { ctx.RejectPrincipal(); return; }
            ctx.ReplacePrincipal(BuildPrincipal(user, sessionId));
            ctx.ShouldRenew = true;
        }
        if (ctx.ShouldRenew || session.ExpiresAt <= now.Add(SessionLifetime / 2))
        {
            // Solo renueva filas vigentes: una petición en vuelo no puede recrear la sesión tras logout.
            var renewed = await db.UserSessions.Where(s => s.Id == hash && s.ExpiresAt > now)
                .ExecuteUpdateAsync(s => s.SetProperty(x => x.ExpiresAt, now.Add(SessionLifetime)));
            if (renewed == 0) ctx.RejectPrincipal();
        }
    }

    /// <summary>Huella corta de la contraseña: si cambia, la sesión se cierra (no se puede renovar).</summary>
    private static string PasswordTag(User u) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(u.PasswordHash)))[..12];

    public static ClaimsPrincipal BuildPrincipal(User user, string sessionId)
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
            new(SessionIdClaim, sessionId),
        };
        return new ClaimsPrincipal(new ClaimsIdentity(claims, CookieAuthenticationDefaults.AuthenticationScheme));
    }
}
