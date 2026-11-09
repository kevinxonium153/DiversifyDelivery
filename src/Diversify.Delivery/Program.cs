using System.Text.Json.Serialization;
using Diversify.Delivery.Core;
using Diversify.Delivery.Modules;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

// Diversify Delivery: catálogo en línea + pedidos a domicilio del supermercado.
// Tres tipos de usuario: cliente (tienda), master (panel) y repartidor (app de entregas).
var builder = WebApplication.CreateBuilder(args);
HostingSecurity.ValidateProductionConfig(builder.Configuration, builder.Environment);
builder.AddHostingSecurity();

var dbPath = DataPaths.Resolve(builder.Configuration, builder.Environment, builder.Configuration["Storage:Database"] ?? "data/delivery.db");
Directory.CreateDirectory(Path.GetDirectoryName(dbPath)!);
builder.Services.AddDbContext<DeliveryDbContext>(o => o.UseSqlite($"Data Source={dbPath}"));

builder.Services.ConfigureHttpJsonOptions(o =>
{
    o.SerializerOptions.Converters.Add(new JsonStringEnumConverter());
    o.SerializerOptions.ReferenceHandler = ReferenceHandler.IgnoreCycles;
});

builder.Services.AddMemoryCache();
builder.Services.AddHttpClient();
builder.Services.AddSingleton<IPasswordHasher<User>, PasswordHasher<User>>();
builder.Services.AddSingleton<PixelPayService>();
builder.Services.AddSingleton<IEmailSender, SmtpEmailSender>();
builder.Services.AddSingleton<DiversifySyncService>();
builder.Services.AddHostedService<DiversifySyncWorker>();

builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(o =>
    {
        o.Cookie.Name = "diversify.delivery";
        o.Cookie.HttpOnly = true;
        // Lax (no Strict): el cliente llega a la tienda desde enlaces de WhatsApp o redes y debe seguir con sesión.
        o.Cookie.SameSite = SameSiteMode.Lax;
        o.Cookie.SecurePolicy = builder.Environment.IsDevelopment() ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;
        o.ExpireTimeSpan = SecurityExtensions.SessionLifetime;
        o.SlidingExpiration = true;
        o.Events.OnValidatePrincipal = SecurityExtensions.ValidateSessionAsync;
        o.Events.OnRedirectToLogin = ctx => { ctx.Response.StatusCode = StatusCodes.Status401Unauthorized; return Task.CompletedTask; };
        o.Events.OnRedirectToAccessDenied = ctx => { ctx.Response.StatusCode = StatusCodes.Status403Forbidden; return Task.CompletedTask; };
    });
builder.Services.AddAuthorization();

var app = builder.Build();

app.UseForwardedHeaders();
app.UseMiddleware<ErrorHandlingMiddleware>();
app.UseSecurityHeaders();
app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = ctx => ctx.Context.Response.Headers.CacheControl = "no-cache",
});
app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();

app.MapGet("/healthz", async (DeliveryDbContext db) =>
    await db.Database.CanConnectAsync() ? Results.Ok(new { status = "ok" }) : Results.StatusCode(503));

var api = app.MapGroup("/api");
AuthEndpoints.Map(api);
PasswordResetEndpoints.Map(api);
RegistrationEndpoints.Map(api);
CatalogEndpoints.Map(api);
Orders.Map(api);
AdminEndpoints.Map(api);
DiversifySyncEndpoints.Map(api);

await DbInitializer.InitializeAsync(app.Services, app.Configuration);

if (!app.Environment.IsDevelopment() && !app.Services.GetRequiredService<IEmailSender>().Configured)
    app.Logger.LogWarning("Sin servidor de correo (Email:Host): los clientes no podrán recuperar su contraseña. Ver docs/DESPLIEGUE-PROXMOX.md.");

app.Run();
