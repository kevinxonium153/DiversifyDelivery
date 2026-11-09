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
    /// Cabeceras de seguridad: CSP estricta (sin CDN ni scripts en línea) en todo el sitio, igual que Diversify POS.
    /// El pago con tarjeta se hace en la página de PixelPay (Hosted Payment), así que no hace falta ninguna excepción.
    /// </summary>
    public static IApplicationBuilder UseSecurityHeaders(this IApplicationBuilder app) => app.Use(async (http, next) =>
    {
        var h = http.Response.Headers;
        h.XContentTypeOptions = "nosniff";
        h["Referrer-Policy"] = "same-origin";
        h.XFrameOptions = "DENY";
        h["Cross-Origin-Opener-Policy"] = "same-origin";
        h.ContentSecurityPolicy = StrictCsp;
        // geolocation: el cliente marca su ubicación y el repartidor ve la distancia.
        h["Permissions-Policy"] = "camera=(self), microphone=(), geolocation=(self), payment=(), serial=(), usb=()";
        if (http.Request.Path.StartsWithSegments("/api")) h.CacheControl = "no-store";
        await next();
    });

    /// <summary>
    /// Dirección pública de la tienda (enlaces de correos y regreso desde PixelPay): App:PublicUrl, o la de la petición.
    /// </summary>
    public static string PublicBaseUrl(IConfiguration config, HttpContext http)
    {
        var configured = config["App:PublicUrl"];
        return (string.IsNullOrWhiteSpace(configured) ? $"{http.Request.Scheme}://{http.Request.Host}" : configured).TrimEnd('/');
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
        if (!string.IsNullOrWhiteSpace(config["PixelPay:Key"]))
        {
            if (string.IsNullOrWhiteSpace(config["PixelPay:SecretKey"])) problems.Add("Falta PixelPay:SecretKey (la llave secreta del comercio).");
            if (!(config["App:PublicUrl"] ?? "").StartsWith("https://", StringComparison.OrdinalIgnoreCase))
                problems.Add("App:PublicUrl debe ser la dirección https de la tienda (PixelPay devuelve ahí al cliente y avisa los pagos).");
            if (!System.Security.Cryptography.HMACSHA3_512.IsSupported)
                problems.Add("El sistema no soporta SHA3-512 (firma de PixelPay): actualiza OpenSSL a 1.1.1 o más reciente.");
        }
        if (problems.Count > 0)
            throw new InvalidOperationException("Configuración de producción insegura:\n - " + string.Join("\n - ", problems) +
                "\nRevisa /etc/diversify-delivery/delivery.env (ver docs/DESPLIEGUE-PROXMOX.md).");
    }
}
