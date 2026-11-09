using System.Net;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.HttpOverrides;

namespace Diversify.Delivery.Core;

/// <summary>Dónde viven los datos: rutas relativas contra Storage:DataRoot (en el servidor /var/lib/diversify-delivery).</summary>
public static class DataPaths
{
    public static string Root(IConfiguration config, IHostEnvironment env)
    {
        var root = config["Storage:DataRoot"];
        return string.IsNullOrWhiteSpace(root) ? env.ContentRootPath : Path.GetFullPath(root);
    }

    public static string Resolve(IConfiguration config, IHostEnvironment env, string path) =>
        Path.IsPathRooted(path) ? path : Path.Combine(Root(config, env), path);
}

/// <summary>Seguridad para correr detrás de Caddy / Cloudflare Tunnel. Mismo esquema que Diversify POS.</summary>
public static class HostingSecurity
{
    public const string LoginLimit = "login";
    public const string PublicLimit = "public";

    public static void AddHostingSecurity(this WebApplicationBuilder builder)
    {
        var config = builder.Configuration;
        var env = builder.Environment;

        builder.Services.Configure<ForwardedHeadersOptions>(o =>
        {
            o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto | ForwardedHeaders.XForwardedHost;
            o.ForwardLimit = 1;
            foreach (var ip in config.GetSection("ReverseProxy:KnownProxies").Get<string[]>() ?? [])
                if (IPAddress.TryParse(ip, out var addr)) o.KnownProxies.Add(addr);
        });

        // Llaves de las cookies en disco: si no, todas las sesiones se cierran al reiniciar.
        var keys = DataPaths.Resolve(config, env, config["Storage:KeysFolder"] ?? "data/keys");
        Directory.CreateDirectory(keys);
        builder.Services.AddDataProtection().SetApplicationName("DiversifyDelivery").PersistKeysToFileSystem(new DirectoryInfo(keys));

        var loginPerMinute = config.GetValue("Security:LoginAttemptsPerMinute", 10);
        builder.Services.AddRateLimiter(o =>
        {
            o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            o.OnRejected = async (ctx, ct) =>
            {
                ctx.HttpContext.Response.Headers.RetryAfter = "60";
                await ctx.HttpContext.Response.WriteAsJsonAsync(new { error = "Demasiados intentos. Espera un minuto e inténtalo de nuevo." }, ct);
            };
            o.AddPolicy(LoginLimit, http => RateLimitPartition.GetFixedWindowLimiter(ClientIp(http),
                _ => new FixedWindowRateLimiterOptions { PermitLimit = loginPerMinute, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
            o.AddPolicy(PublicLimit, http => RateLimitPartition.GetFixedWindowLimiter(ClientIp(http),
                _ => new FixedWindowRateLimiterOptions { PermitLimit = 120, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
        });

        // Fotos de productos (≤ 400 KB) y comprobantes son lo más grande que se sube.
        builder.WebHost.ConfigureKestrel(k => k.Limits.MaxRequestBodySize = 4 * 1024 * 1024);
    }

    private static string ClientIp(HttpContext http) => http.Connection.RemoteIpAddress?.ToString() ?? "desconocida";

    private const string StrictCsp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
        "font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

    /// <summary>
    /// Cabeceras de seguridad: CSP estricta (sin CDN ni scripts en línea), igual que Diversify POS.
    /// Única excepción: la página de pago (/pago/), donde el SDK de PixelPay (alojado aquí) habla con PixelPay y,
    /// si el banco pide 3-D Secure, carga el script de Cardinal Commerce y muestra la verificación del banco en un
    /// marco. <paramref name="paymentOrigin"/> es el origen de PixelPay (null = sin PixelPay).
    /// </summary>
    public static IApplicationBuilder UseSecurityHeaders(this IApplicationBuilder app, string? paymentOrigin = null)
    {
        const string cardinal = "https://songbird.cardinalcommerce.com https://songbirdstag.cardinalcommerce.com";
        var paymentCsp = paymentOrigin is null ? StrictCsp :
            "default-src 'self'; " +
            $"script-src 'self' {cardinal}; " +
            "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self'; " +
            $"connect-src 'self' {paymentOrigin} https://*.cardinalcommerce.com; " +
            // La verificación 3-D Secure la muestra el banco emisor de la tarjeta (cualquier dominio HTTPS).
            "frame-src https:; form-action 'self' https:; " +
            "object-src 'none'; base-uri 'self'; frame-ancestors 'none'";
        return app.Use(async (http, next) => await WriteHeaders(http, next, paymentCsp));
    }

    private static async Task WriteHeaders(HttpContext http, Func<Task> next, string paymentCsp)
    {
        var h = http.Response.Headers;
        h.XContentTypeOptions = "nosniff";
        h["Referrer-Policy"] = "same-origin";
        h.XFrameOptions = "DENY";
        h["Cross-Origin-Opener-Policy"] = "same-origin";
        h.ContentSecurityPolicy = http.Request.Path.StartsWithSegments("/pago") ? paymentCsp : StrictCsp;
        // geolocation: el cliente marca su ubicación y el repartidor ve la distancia.
        h["Permissions-Policy"] = "camera=(self), microphone=(), geolocation=(self), payment=(self), serial=(), usb=()";
        if (http.Request.Path.StartsWithSegments("/api")) h.CacheControl = "no-store";
        await next();
    }

    private static readonly string[] KnownDefaults = ["master123", "repartidor123", "cliente123", "admin123", "cambiar", "changeme"];

    /// <summary>En producción no arranca con contraseñas de ejemplo, datos demo ni AllowedHosts=*.</summary>
    public static void ValidateProductionConfig(IConfiguration config, IHostEnvironment env)
    {
        if (env.IsDevelopment()) return;
        var problems = new List<string>();
        var pwd = config["Seed:MasterPassword"] ?? "";
        if (pwd.Length < 12 || KnownDefaults.Contains(pwd, StringComparer.OrdinalIgnoreCase))
            problems.Add("Seed:MasterPassword debe tener al menos 12 caracteres y no ser una contraseña de ejemplo.");
        if (config.GetValue("Seed:DemoData", false)) problems.Add("Seed:DemoData debe ser false en producción.");
        if ((config["AllowedHosts"] ?? "*") == "*") problems.Add("AllowedHosts debe ser el dominio (ej. delivery.diversify.hn).");
        if (config.GetValue("Payments:Simulated", false)) problems.Add("Payments:Simulated debe ser false en producción (cobraría la inscripción sin dinero real).");
        if (config.GetValue("PixelPay:Sandbox", false)) problems.Add("PixelPay:Sandbox debe ser false en producción (los cobros serían de prueba).");
        if (!string.IsNullOrWhiteSpace(config["PixelPay:Key"]) && string.IsNullOrWhiteSpace(config["PixelPay:SecretKey"]))
            problems.Add("Falta PixelPay:SecretKey (la llave secreta del comercio).");
        if (problems.Count > 0)
            throw new InvalidOperationException("Configuración de producción insegura:\n - " + string.Join("\n - ", problems) +
                "\nRevisa /etc/diversify-delivery/delivery.env (ver docs/DESPLIEGUE-PROXMOX.md).");
    }
}
