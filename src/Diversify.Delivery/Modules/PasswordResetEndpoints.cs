using System.Net;
using System.Security.Cryptography;
using System.Text;
using Diversify.Delivery.Core;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

namespace Diversify.Delivery.Modules;

// "Olvidé mi contraseña" por correo.
//  1. POST /api/auth/forgot { email }: si existe una cuenta activa con ese correo, se le manda un enlace.
//     La respuesta es SIEMPRE la misma (no revela qué correos tienen cuenta).
//  2. El enlace lleva un código aleatorio de 256 bits en el fragmento (#/restablecer/<código>): el fragmento no
//     viaja en los registros del servidor ni del proxy. Vence en 1 hora y sirve una vez.
//  3. POST /api/auth/reset { token, password }: cambia la contraseña, invalida los demás enlaces e inicia sesión.
//     Las sesiones abiertas en otros equipos se cierran (cambió la contraseña).

public record ForgotInput(string Email);
public record ResetInput(string Token, string Password);

public static class PasswordResetEndpoints
{
    public static readonly TimeSpan Validity = TimeSpan.FromHours(1);
    private const int MaxPerHour = 3;
    private const string GenericMessage = "Si el correo tiene una cuenta, te enviamos un enlace para crear una contraseña nueva. Revisa también la carpeta de spam.";

    public static string HashToken(string token) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    public static void Map(RouteGroupBuilder api)
    {
        var auth = api.MapGroup("/auth");

        auth.MapPost("/forgot", async (ForgotInput input, DeliveryDbContext db, IEmailSender email, IConfiguration config,
            HttpContext http, ILogger<ForgotInput> log, CancellationToken ct) =>
        {
            var address = (input.Email ?? "").Trim().ToLowerInvariant();
            AppException.ThrowIf(address.Length is 0 or > 120 || !address.Contains('@'), "Escribe el correo con el que te registraste.");

            var user = await db.Users.FirstOrDefaultAsync(u => u.Email == address && u.Status != AccountStatus.Suspendido, ct);
            if (user is null) return Results.Ok(new { message = GenericMessage });

            var recent = await db.PasswordResets.CountAsync(r => r.UserId == user.Id && r.CreatedAt > DateTime.Now.AddHours(-1), ct);
            if (recent >= MaxPerHour) return Results.Ok(new { message = GenericMessage }); // sin aviso: no revela nada

            // Un enlace nuevo invalida los anteriores que no se usaron.
            await db.PasswordResets.Where(r => r.UserId == user.Id && r.UsedAt == null && r.ExpiresAt > DateTime.Now)
                .ExecuteUpdateAsync(s => s.SetProperty(r => r.ExpiresAt, DateTime.Now), ct);

            var token = Base64Url(RandomNumberGenerator.GetBytes(32));
            db.PasswordResets.Add(new PasswordReset
            {
                UserId = user.Id, TokenHash = HashToken(token), ExpiresAt = DateTime.Now.Add(Validity),
                RequestIp = http.Connection.RemoteIpAddress?.ToString(),
            });
            await db.SaveChangesAsync(ct);

            var store = (await db.Settings.AsNoTracking().OrderBy(x => x.Id).FirstAsync(ct)).StoreName;
            var link = $"{HostingSecurity.PublicBaseUrl(config, http)}/#/restablecer/{token}";
            try
            {
                await email.SendAsync(BuildEmail(user, store, link), ct);
            }
            catch (Exception ex) when (ex is System.Net.Mail.SmtpException or IOException or InvalidOperationException)
            {
                // El cliente ve el mismo mensaje; el error queda en el registro para el administrador.
                log.LogError(ex, "No se pudo enviar el correo de recuperación a {UserId}", user.Id);
            }
            return Results.Ok(new { message = GenericMessage });
        }).RequireRateLimiting(HostingSecurity.LoginLimit);

        // Revisa si un enlace sirve, antes de mostrar el formulario (no lo consume).
        auth.MapGet("/reset/{token}", async (string token, DeliveryDbContext db, CancellationToken ct) =>
        {
            var reset = await FindValidAsync(db, token, ct);
            AppException.ThrowIf(reset is null, "El enlace venció o ya se usó. Pide uno nuevo.");
            var user = await db.Users.AsNoTracking().FirstAsync(u => u.Id == reset.UserId, ct);
            return new { name = user.FullName.Split(' ')[0], expiresAt = reset.ExpiresAt };
        }).RequireRateLimiting(HostingSecurity.LoginLimit);

        auth.MapPost("/reset", async (ResetInput input, DeliveryDbContext db, IPasswordHasher<User> hasher, IMemoryCache cache,
            HttpContext http, CancellationToken ct) =>
        {
            AppException.ThrowIf((input.Password ?? "").Length < 8, "La contraseña debe tener al menos 8 caracteres.");
            var reset = await FindValidAsync(db, input.Token, ct);
            AppException.ThrowIf(reset is null, "El enlace venció o ya se usó. Pide uno nuevo.");
            var user = await db.Users.FirstAsync(u => u.Id == reset.UserId, ct);
            AppException.ThrowIf(user.Status == AccountStatus.Suspendido, "Tu cuenta está suspendida. Comunícate con el supermercado.");

            user.PasswordHash = hasher.HashPassword(user, input.Password!);
            reset.UsedAt = DateTime.Now;
            await db.PasswordResets.Where(r => r.UserId == user.Id && r.Id != reset.Id && r.UsedAt == null)
                .ExecuteUpdateAsync(s => s.SetProperty(r => r.ExpiresAt, DateTime.Now), ct);
            await db.SaveChangesAsync(ct);
            cache.Remove(SecurityExtensions.SessionCacheKey(user.Id));
            await http.SignInUserAsync(user);
            return user.ToDto();
        }).RequireRateLimiting(HostingSecurity.LoginLimit);
    }

    private static async Task<PasswordReset?> FindValidAsync(DeliveryDbContext db, string? token, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(token) || token.Length > 100) return null;
        var hash = HashToken(token.Trim());
        return await db.PasswordResets.FirstOrDefaultAsync(r => r.TokenHash == hash && r.UsedAt == null && r.ExpiresAt > DateTime.Now, ct);
    }

    private static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static EmailMessage BuildEmail(User user, string store, string link)
    {
        var name = user.FullName.Split(' ')[0];
        var minutes = (int)Validity.TotalMinutes;
        var text = $"Hola {name}:\n\nRecibimos una solicitud para cambiar la contraseña de tu cuenta de {store} en Diversify Delivery.\n\n" +
                   $"Crea tu contraseña nueva aquí (el enlace vence en {minutes} minutos y sirve una sola vez):\n{link}\n\n" +
                   "Si no lo pediste tú, ignora este correo: tu contraseña no cambia.\n";
        var e = (string s) => WebUtility.HtmlEncode(s);
        var html = $"""
            <div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;margin:0 auto;color:#18181b">
              <p style="font-size:20px;font-weight:800;margin:0 0 4px">diversify<span style="color:#f59e0b">.</span></p>
              <p style="font-size:11px;font-weight:800;letter-spacing:4px;color:#f59e0b;margin:0 0 24px">DELIVERY</p>
              <p>Hola {e(name)}:</p>
              <p>Recibimos una solicitud para cambiar la contraseña de tu cuenta de <strong>{e(store)}</strong>.</p>
              <p style="margin:28px 0"><a href="{e(link)}" style="background:#f59e0b;color:#18181b;padding:14px 22px;border-radius:12px;text-decoration:none;font-weight:700">Crear contraseña nueva</a></p>
              <p style="color:#52525b;font-size:13px">El enlace vence en {minutes} minutos y sirve una sola vez. Si el botón no funciona, copia esta dirección en tu navegador:<br><span style="word-break:break-all">{e(link)}</span></p>
              <p style="color:#52525b;font-size:13px">Si no lo pediste tú, ignora este correo: tu contraseña no cambia.</p>
            </div>
            """;
        return new EmailMessage(user.Email!, $"Cambia tu contraseña · {store}", html, text);
    }
}
