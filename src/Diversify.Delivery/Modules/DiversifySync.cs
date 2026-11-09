using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Diversify.Delivery.Core;
using Microsoft.EntityFrameworkCore;

namespace Diversify.Delivery.Modules;

// Integración con Diversify POS (el sistema del supermercado, en su propio contenedor de Proxmox).
//
// Diversify Delivery inicia sesión en Diversify POS con un usuario normal de la tienda (rol "bodega", solo
// lectura de productos) y copia categorías, productos, precios, existencia y fotos. No hace falta cambiar nada
// en Diversify POS: usa su API pública (/api/auth/login, /api/categories, /api/products).
//
// Configuración (en /etc/diversify-delivery/delivery.env):
//   Diversify__BaseUrl=https://pos.diversify.hn
//   Diversify__Company=<código de la empresa en Diversify>   (vacío = empresa principal)
//   Diversify__Username=delivery
//   Diversify__Password=<contraseña>
//   Diversify__SyncMinutes=15        (0 = solo manual, desde el panel)
//   Diversify__PublishNewProducts=true (productos nuevos visibles en la tienda al llegar)

public record SyncResult(bool Ok, string Message, int Categories, int Created, int Updated, int Deactivated);

public class DiversifySyncService(IServiceScopeFactory scopes, IConfiguration config, ILogger<DiversifySyncService> log)
{
    private readonly SemaphoreSlim gate = new(1, 1);

    public bool Configured => !string.IsNullOrWhiteSpace(config["Diversify:BaseUrl"]) && !string.IsNullOrWhiteSpace(config["Diversify:Username"]);
    public string? BaseUrl => config["Diversify:BaseUrl"];

    private record DvCategory(int Id, string Name, bool Active);
    private record DvProduct(int Id, string Code, string? Barcode, string Name, int? CategoryId, string? Category, string Unit,
        decimal Price, decimal TaxRate, decimal Stock, bool Active, string? ImageData);

    public async Task<SyncResult> RunAsync(CancellationToken ct = default)
    {
        if (!Configured) return new(false, "La conexión con Diversify POS no está configurada (Diversify:BaseUrl y Diversify:Username).", 0, 0, 0, 0);
        if (!await gate.WaitAsync(0, ct)) return new(false, "Ya hay una sincronización en curso.", 0, 0, 0, 0);
        try
        {
            var result = await SyncCoreAsync(ct);
            await SaveResultAsync(result);
            return result;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException or AppException)
        {
            log.LogWarning(ex, "Sincronización con Diversify POS falló");
            var result = new SyncResult(false, $"No se pudo sincronizar: {ex.Message}", 0, 0, 0, 0);
            await SaveResultAsync(result);
            return result;
        }
        finally
        {
            gate.Release();
        }
    }

    private async Task SaveResultAsync(SyncResult r)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<DeliveryDbContext>();
        var s = await db.Settings.OrderBy(x => x.Id).FirstAsync();
        s.LastSyncAt = DateTime.Now;
        s.LastSyncResult = r.Message.Length > 500 ? r.Message[..500] : r.Message;
        await db.SaveChangesAsync();
    }

    private async Task<SyncResult> SyncCoreAsync(CancellationToken ct)
    {
        // Cliente con su propia caja de cookies: la sesión de Diversify vive solo durante esta sincronización.
        using var handler = new HttpClientHandler { CookieContainer = new CookieContainer(), UseCookies = true };
        using var http = new HttpClient(handler) { BaseAddress = new Uri(config["Diversify:BaseUrl"]!.TrimEnd('/') + "/"), Timeout = TimeSpan.FromSeconds(60) };
        http.DefaultRequestHeaders.UserAgent.ParseAdd("DiversifyDelivery/1.0");

        var login = await http.PostAsJsonAsync("api/auth/login", new
        {
            username = config["Diversify:Username"],
            password = config["Diversify:Password"],
            company = config["Diversify:Company"] ?? "",
        }, ct);
        if (!login.IsSuccessStatusCode)
            throw new AppException($"Diversify POS rechazó el usuario ({(int)login.StatusCode}). Revisa Diversify:Username y Diversify:Password.");

        var json = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        var dvCategories = await http.GetFromJsonAsync<List<DvCategory>>("api/categories", json, ct) ?? [];
        var dvProducts = new List<DvProduct>();
        for (var offset = 0; ; offset += 2000)
        {
            var page = await http.GetFromJsonAsync<List<DvProduct>>($"api/products?limit=2000&offset={offset}", json, ct) ?? [];
            dvProducts.AddRange(page);
            if (page.Count < 2000) break;
        }
        try { await http.PostAsync("api/auth/logout", null, ct); } catch (HttpRequestException) { /* no importa */ }

        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<DeliveryDbContext>();
        var settings = await db.Settings.OrderBy(x => x.Id).FirstAsync(ct);
        var publishNew = config.GetValue("Diversify:PublishNewProducts", true);

        // Categorías: por id de Diversify o, la primera vez, por nombre.
        var categories = await db.Categories.ToListAsync(ct);
        var catMap = new Dictionary<int, Category>();
        foreach (var dc in dvCategories)
        {
            var c = categories.FirstOrDefault(x => x.DiversifyId == dc.Id)
                    ?? categories.FirstOrDefault(x => x.DiversifyId == null && string.Equals(x.Name, dc.Name, StringComparison.OrdinalIgnoreCase));
            if (c is null)
            {
                c = new Category { Name = dc.Name, Icon = "🛒", SortOrder = 100 + categories.Count, Active = dc.Active };
                db.Categories.Add(c);
                categories.Add(c);
            }
            c.DiversifyId = dc.Id;
            catMap[dc.Id] = c;
        }
        await db.SaveChangesAsync(ct);

        var products = await db.Products.ToListAsync(ct);
        int created = 0, updated = 0, deactivated = 0;
        var seen = new HashSet<int>();
        foreach (var dp in dvProducts)
        {
            seen.Add(dp.Id);
            var p = products.FirstOrDefault(x => x.DiversifyId == dp.Id)
                    ?? products.FirstOrDefault(x => x.DiversifyId == null && x.Code == dp.Code);
            var isNew = p is null;
            if (p is null)
            {
                if (!dp.Active) continue; // no traer productos que ya están inactivos en el POS
                p = new Product { Active = publishNew, Price = dp.Price };
                db.Products.Add(p);
                products.Add(p);
            }
            var before = (p.Name, p.Price, p.Stock, p.Active, p.CategoryId, img: p.ImageData?.Length);
            p.DiversifyId = dp.Id;
            p.Source = ProductSource.Diversify;
            p.Code = dp.Code.Length > 40 ? dp.Code[..40] : dp.Code;
            p.Barcode = dp.Barcode;
            p.Name = dp.Name.Length > 160 ? dp.Name[..160] : dp.Name;
            p.Unit = dp.Unit;
            p.TaxRate = dp.TaxRate;
            p.Stock = dp.Stock;
            p.CategoryId = dp.CategoryId is int cid && catMap.TryGetValue(cid, out var cat) ? cat.Id : p.CategoryId;
            if ((isNew || settings.SyncPrices) && !p.PriceLocked && dp.Price > 0) p.Price = dp.Price;
            if (!dp.Active && p.Active) { p.Active = false; deactivated++; }
            if (dp.ImageData is not null && dp.ImageData.Length <= 560_000) p.ImageData = dp.ImageData;
            if (isNew) created++;
            else if (before != (p.Name, p.Price, p.Stock, p.Active, p.CategoryId, p.ImageData?.Length)) { updated++; p.UpdatedAt = DateTime.Now; }
        }
        // Productos borrados en el POS: se ocultan (no se borran, por los pedidos anteriores).
        foreach (var p in products.Where(p => p.Source == ProductSource.Diversify && p.DiversifyId is int id && !seen.Contains(id) && p.Active))
        {
            p.Active = false;
            deactivated++;
        }
        await db.SaveChangesAsync(ct);
        var msg = $"Sincronizado: {dvProducts.Count} productos leídos, {created} nuevos, {updated} actualizados, {deactivated} ocultados.";
        log.LogInformation("Diversify POS: {Message}", msg);
        return new(true, msg, catMap.Count, created, updated, deactivated);
    }
}

/// <summary>Sincronización automática cada Diversify:SyncMinutes (0 = apagada).</summary>
public class DiversifySyncWorker(DiversifySyncService sync, IConfiguration config) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var minutes = config.GetValue("Diversify:SyncMinutes", 0);
        if (minutes <= 0 || !sync.Configured) return;
        await Task.Delay(TimeSpan.FromSeconds(20), stoppingToken);
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(minutes));
        do { await sync.RunAsync(stoppingToken); }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}

public static class DiversifySyncEndpoints
{
    public static void Map(RouteGroupBuilder api)
    {
        var g = api.MapGroup("/admin/diversify").RequireRoles(Roles.Master);

        g.MapGet("/", async (DiversifySyncService sync, IConfiguration config, DeliveryDbContext db) =>
        {
            var s = await db.Settings.AsNoTracking().OrderBy(x => x.Id).FirstAsync();
            return new
            {
                configured = sync.Configured,
                baseUrl = sync.BaseUrl,
                company = config["Diversify:Company"],
                syncMinutes = config.GetValue("Diversify:SyncMinutes", 0),
                s.SyncPrices, s.LastSyncAt, s.LastSyncResult,
                linkedProducts = await db.Products.CountAsync(p => p.Source == ProductSource.Diversify),
            };
        });

        g.MapPost("/sync", async (DiversifySyncService sync, CancellationToken ct) =>
        {
            var r = await sync.RunAsync(ct);
            return r.Ok ? Results.Ok(r) : Results.Json(new { error = r.Message }, statusCode: StatusCodes.Status502BadGateway);
        });
    }
}
