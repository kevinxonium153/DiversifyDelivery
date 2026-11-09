using System.Net.Mail;
using System.Security.Claims;
using Diversify.Delivery.Core;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

namespace Diversify.Delivery.Modules;

public record LoginRequest(string Login, string Password);
public record RegisterRequest(string FullName, string Email, string Phone, string Password);
public record ProfileInput(string FullName, string? Phone, string? CurrentPassword, string? NewPassword);
public record UserDto(int Id, string Login, string FullName, string? Email, string? Phone, string Role, string Status,
    string? Vehicle, bool OnDuty, DateTime CreatedAt);

public static class AuthEndpoints
{
    public static UserDto ToDto(this User u) =>
        new(u.Id, u.Login, u.FullName, u.Email, u.Phone, u.Role, u.Status.ToString(), u.Vehicle, u.OnDuty, u.CreatedAt);

    public static void Map(RouteGroupBuilder api)
    {
        var auth = api.MapGroup("/auth");

        auth.MapPost("/login", async (LoginRequest req, DeliveryDbContext db, IPasswordHasher<User> hasher, HttpContext http) =>
        {
            var login = (req.Login ?? "").Trim().ToLowerInvariant();
            var user = await db.Users.FirstOrDefaultAsync(u => u.Login == login);
            var ok = user is not null && !string.IsNullOrEmpty(req.Password) &&
                     hasher.VerifyHashedPassword(user, user.PasswordHash, req.Password) != PasswordVerificationResult.Failed;
            if (!ok) throw new AppException("Usuario o contraseña incorrectos.", StatusCodes.Status401Unauthorized);
            AppException.ThrowIf(user!.Status == AccountStatus.Suspendido, "Tu cuenta está suspendida. Comunícate con el supermercado.");
            user.LastLoginAt = DateTime.Now;
            await db.SaveChangesAsync();
            await http.SignInUserAsync(user);
            return user.ToDto();
        }).RequireRateLimiting(HostingSecurity.LoginLimit);

        // Registro de cliente: la cuenta queda "PendientePago" hasta pagar la inscripción ($5).
        auth.MapPost("/register", async (RegisterRequest req, DeliveryDbContext db, IPasswordHasher<User> hasher, HttpContext http) =>
        {
            var name = Text.Required(req.FullName, 120, "El nombre");
            var email = Text.Required(req.Email, 120, "El correo").ToLowerInvariant();
            AppException.ThrowIf(!MailAddress.TryCreate(email, out _) || !email.Contains('.'), "El correo no es válido.");
            var phone = Text.Required(req.Phone, 30, "El teléfono");
            AppException.ThrowIf(phone.Count(char.IsDigit) < 8, "El teléfono debe tener al menos 8 dígitos.");
            AppException.ThrowIf((req.Password ?? "").Length < 8, "La contraseña debe tener al menos 8 caracteres.");
            AppException.ThrowIf(await db.Users.AnyAsync(u => u.Login == email), "Ya existe una cuenta con ese correo. Inicia sesión.");

            var user = new User { Login = email, Email = email, FullName = name, Phone = phone, Role = Roles.Customer, Status = AccountStatus.PendientePago };
            user.PasswordHash = hasher.HashPassword(user, req.Password!);
            db.Users.Add(user);
            await db.SaveChangesAsync();
            await http.SignInUserAsync(user);
            return Results.Created("/api/auth/me", user.ToDto());
        }).RequireRateLimiting(HostingSecurity.LoginLimit);

        auth.MapPost("/logout", async (HttpContext http) =>
        {
            await http.RevokeSessionAsync();
            await http.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            return Results.NoContent();
        });

        // Sin sesión responde 204 (visitante): la tienda se puede ver sin cuenta.
        auth.MapGet("/me", async (ClaimsPrincipal me, DeliveryDbContext db) =>
        {
            if (me.Identity?.IsAuthenticated != true) return Results.NoContent();
            var user = await db.Users.FindAsync(me.UserId());
            return user is null ? Results.NoContent() : Results.Ok(user.ToDto());
        });

        auth.MapPut("/profile", async (ProfileInput input, ClaimsPrincipal me, DeliveryDbContext db, IPasswordHasher<User> hasher,
            IMemoryCache cache, HttpContext http) =>
        {
            var user = await db.Users.FindAsync(me.UserId()) ?? throw AppException.NotFound("Usuario");
            user.FullName = Text.Required(input.FullName, 120, "El nombre");
            user.Phone = Text.Clean(input.Phone, 30);
            if (!string.IsNullOrEmpty(input.NewPassword))
            {
                AppException.ThrowIf(input.NewPassword.Length < 8, "La contraseña nueva debe tener al menos 8 caracteres.");
                AppException.ThrowIf(hasher.VerifyHashedPassword(user, user.PasswordHash, input.CurrentPassword ?? "") == PasswordVerificationResult.Failed,
                    "La contraseña actual no es correcta.");
                user.PasswordHash = hasher.HashPassword(user, input.NewPassword);
            }
            await db.SaveChangesAsync();
            cache.Remove(SecurityExtensions.SessionCacheKey(user.Id));
            await http.SignInUserAsync(user);
            return user.ToDto();
        }).RequireAuthorization();
    }
}
