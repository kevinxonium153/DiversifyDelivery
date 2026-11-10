using System.Security.Claims;
using Diversify.Delivery.Core;
using Microsoft.EntityFrameworkCore;

namespace Diversify.Delivery.Modules;

public record CategoryInput(string Name, string? Icon, int SortOrder = 0, bool Active = true);
public record ProductInput(string? Code, string? Barcode, string Name, string? Description, string? Icon, int? CategoryId, string? Unit,
    decimal Price, decimal? CompareAtPrice, decimal TaxRate, bool Active = true, bool Featured = false,
    string? ImageData = null, bool UpdateImage = false);
public record PriceInput(decimal Price, decimal? CompareAtPrice);
public record BulkPriceInput(int? CategoryId, decimal Percent, bool RoundToHalf = true);

/// <summary>Producto como lo ve el cliente en la tienda.</summary>
public record CatalogProductDto(int Id, string Name, string? Description, int? CategoryId, string? Category, string? Icon, string Unit,
    decimal Price, decimal? CompareAtPrice, bool Available, bool Featured, string? Image);

/// <summary>Producto como lo administra el master.</summary>
public record AdminProductDto(int Id, string Code, string? Barcode, string Name, string? Description, string? Icon, int? CategoryId, string? Category,
    string Unit, decimal Price, decimal? CompareAtPrice, decimal TaxRate, decimal? Stock, bool Active, bool Featured, string? Image,
    string Source, bool PriceLocked, DateTime UpdatedAt);

public static class CatalogEndpoints
{
    private static string? ImageUrl(Product p) => p.ImageData is null ? null : $"/api/catalog/images/{p.Id}?v={p.UpdatedAt.Ticks}";

    public static void Map(RouteGroupBuilder api)
    {
        // ---------- Público: la tienda se puede ver sin cuenta ----------
        var pub = api.MapGroup("/catalog").RequireRateLimiting(HostingSecurity.PublicLimit);

        pub.MapGet("/categories", async (DeliveryDbContext db) =>
            await db.Categories.AsNoTracking().Where(c => c.Active).OrderBy(c => c.SortOrder).ThenBy(c => c.Name)
                .Select(c => new { c.Id, c.Name, c.Icon, products = db.Products.Count(p => p.CategoryId == c.Id && p.Active) })
                .Where(c => c.products > 0).ToListAsync());

        pub.MapGet("/products", async (DeliveryDbContext db, string? search, int? categoryId, bool? featured, bool? offers, int? limit, int? offset) =>
        {
            var q = db.Products.AsNoTracking().Include(p => p.Category).Where(p => p.Active && (p.Category == null || p.Category.Active));
            if (!string.IsNullOrWhiteSpace(search))
            {
                var s = search.Trim().ToLower();
                q = q.Where(p => p.Name.ToLower().Contains(s) || p.Code.ToLower() == s || p.Barcode == search.Trim());
            }
            if (categoryId is not null) q = q.Where(p => p.CategoryId == categoryId);
            if (featured == true) q = q.Where(p => p.Featured);
            if (offers == true) q = q.Where(p => p.CompareAtPrice != null && p.CompareAtPrice > p.Price);
            var total = await q.CountAsync();
            var items = await q.OrderBy(p => p.Category!.SortOrder).ThenBy(p => p.Name)
                .Skip(Math.Max(offset ?? 0, 0)).Take(Math.Clamp(limit ?? 60, 1, 200)).ToListAsync();
            return new
            {
                total,
                items = items.Select(p => new CatalogProductDto(p.Id, p.Name, p.Description, p.CategoryId, p.Category?.Name, p.Icon ?? p.Category?.Icon,
                    p.Unit, p.Price, p.CompareAtPrice > p.Price ? p.CompareAtPrice : null, p.Stock is null || p.Stock > 0, p.Featured, ImageUrl(p))),
            };
        });

        // Las fotos se sirven aparte (no dentro del listado) para que la tienda cargue rápido en datos móviles.
        pub.MapGet("/images/{id:int}", async (int id, DeliveryDbContext db, HttpContext http) =>
        {
            var data = await db.Products.Where(p => p.Id == id).Select(p => p.ImageData).FirstOrDefaultAsync();
            if (data is null) return Results.NotFound();
            var comma = data.IndexOf(',');
            var mime = data[5..data.IndexOf(';')];
            http.Response.Headers.CacheControl = "public, max-age=604800, immutable";
            return Results.File(Convert.FromBase64String(data[(comma + 1)..]), mime);
        });

        // Ajustes públicos de la tienda (envío, mínimo, horario, inscripción).
        api.MapGet("/store", async (DeliveryDbContext db) =>
        {
            var s = await db.Settings.AsNoTracking().OrderBy(x => x.Id).FirstAsync();
            return new
            {
                s.StoreName, s.StorePhone, s.StoreAddress, s.DeliveryFee, s.MinimumOrder, s.FreeDeliveryFrom,
                s.RegistrationFeeUsd, registrationFeeHnl = Money.Round(s.RegistrationFeeUsd * s.ExchangeRate), s.ExchangeRate,
                s.PointsPercent, s.ReferralPercent,
                s.OpensAt, s.ClosesAt, s.AcceptingOrders, openNow = Orders.IsOpen(s),
            };
        });

        // ---------- Master: productos, categorías y precios ----------
        var admin = api.MapGroup("/admin").RequireRoles(Roles.Master);

        admin.MapGet("/categories", async (DeliveryDbContext db) =>
            await db.Categories.AsNoTracking().OrderBy(c => c.SortOrder).ThenBy(c => c.Name)
                .Select(c => new { c.Id, c.Name, c.Icon, c.SortOrder, c.Active, c.DiversifyId, products = db.Products.Count(p => p.CategoryId == c.Id) })
                .ToListAsync());

        admin.MapPost("/categories", async (CategoryInput input, DeliveryDbContext db) =>
        {
            var c = new Category();
            ApplyCategory(c, input);
            db.Categories.Add(c);
            await db.SaveChangesAsync();
            return Results.Created($"/api/admin/categories/{c.Id}", c);
        });

        admin.MapPut("/categories/{id:int}", async (int id, CategoryInput input, DeliveryDbContext db) =>
        {
            var c = await db.Categories.FindAsync(id) ?? throw AppException.NotFound("Categoría");
            ApplyCategory(c, input);
            await db.SaveChangesAsync();
            return c;
        });

        admin.MapGet("/products", async (DeliveryDbContext db, string? search, int? categoryId, bool? active, int? limit) =>
        {
            var q = db.Products.AsNoTracking().Include(p => p.Category).AsQueryable();
            if (!string.IsNullOrWhiteSpace(search))
            {
                var s = search.Trim().ToLower();
                q = q.Where(p => p.Name.ToLower().Contains(s) || p.Code.ToLower().Contains(s) || p.Barcode == search.Trim());
            }
            if (categoryId is not null) q = q.Where(p => p.CategoryId == categoryId);
            if (active is not null) q = q.Where(p => p.Active == active);
            var items = await q.OrderBy(p => p.Name).Take(Math.Clamp(limit ?? 500, 1, 5000)).ToListAsync();
            return items.Select(ToAdminDto);
        });

        admin.MapPost("/products", async (ProductInput input, DeliveryDbContext db, ClaimsPrincipal me) =>
        {
            var p = new Product();
            await ApplyProductAsync(db, p, input, me.DisplayName());
            db.Products.Add(p);
            await db.SaveChangesAsync();
            return Results.Created($"/api/admin/products/{p.Id}", ToAdminDto(p));
        });

        admin.MapPut("/products/{id:int}", async (int id, ProductInput input, DeliveryDbContext db, ClaimsPrincipal me) =>
        {
            var p = await db.Products.Include(x => x.Category).FirstOrDefaultAsync(x => x.Id == id) ?? throw AppException.NotFound("Producto");
            await ApplyProductAsync(db, p, input, me.DisplayName());
            await db.SaveChangesAsync();
            return ToAdminDto(p);
        });

        // Cambio rápido de precio (desde la tabla, sin abrir el formulario).
        admin.MapPut("/products/{id:int}/price", async (int id, PriceInput input, DeliveryDbContext db, ClaimsPrincipal me) =>
        {
            var p = await db.Products.Include(x => x.Category).FirstOrDefaultAsync(x => x.Id == id) ?? throw AppException.NotFound("Producto");
            SetPrice(db, p, input.Price, me.DisplayName());
            p.CompareAtPrice = input.CompareAtPrice is > 0 ? Money.Round(input.CompareAtPrice.Value) : null;
            p.UpdatedAt = DateTime.Now;
            await db.SaveChangesAsync();
            return ToAdminDto(p);
        });

        // Subir o bajar precios por porcentaje (toda la tienda o una categoría).
        admin.MapPost("/products/bulk-price", async (BulkPriceInput input, DeliveryDbContext db, ClaimsPrincipal me) =>
        {
            AppException.ThrowIf(input.Percent is 0 or < -90 or > 300, "El porcentaje debe estar entre -90 % y 300 % (y no ser 0).");
            var q = db.Products.Where(p => p.Active);
            if (input.CategoryId is not null) q = q.Where(p => p.CategoryId == input.CategoryId);
            var list = await q.ToListAsync();
            foreach (var p in list)
            {
                var price = p.Price * (1 + input.Percent / 100m);
                price = input.RoundToHalf ? Math.Round(price * 2, MidpointRounding.AwayFromZero) / 2 : Money.Round(price);
                SetPrice(db, p, price, me.DisplayName());
                p.UpdatedAt = DateTime.Now;
            }
            await db.SaveChangesAsync();
            return new { updated = list.Count };
        });

        admin.MapGet("/products/{id:int}/price-history", async (int id, DeliveryDbContext db) =>
            await db.PriceChanges.AsNoTracking().Where(c => c.ProductId == id).OrderByDescending(c => c.Id).Take(50).ToListAsync());
    }

    private static AdminProductDto ToAdminDto(Product p) =>
        new(p.Id, p.Code, p.Barcode, p.Name, p.Description, p.Icon, p.CategoryId, p.Category?.Name, p.Unit, p.Price, p.CompareAtPrice, p.TaxRate,
            p.Stock, p.Active, p.Featured, ImageUrl(p), p.Source.ToString(), p.PriceLocked, p.UpdatedAt);

    private static void ApplyCategory(Category c, CategoryInput input)
    {
        c.Name = Text.Required(input.Name, 80, "El nombre");
        c.Icon = Text.Clean(input.Icon, 16) ?? "🛒";
        c.SortOrder = input.SortOrder;
        c.Active = input.Active;
    }

    private static void SetPrice(DeliveryDbContext db, Product p, decimal price, string by)
    {
        price = Money.Round(price);
        AppException.ThrowIf(price <= 0, $"El precio de {p.Name} debe ser mayor que cero.");
        if (price == p.Price) return;
        if (p.Id > 0) db.PriceChanges.Add(new PriceChange { ProductId = p.Id, OldPrice = p.Price, NewPrice = price, ChangedBy = by });
        p.Price = price;
        // Si el producto viene de Diversify POS y el master lo cambió aquí, la sincronización ya no lo pisa.
        if (p.Source == ProductSource.Diversify) p.PriceLocked = true;
    }

    private static async Task ApplyProductAsync(DeliveryDbContext db, Product p, ProductInput input, string by)
    {
        p.Name = Text.Required(input.Name, 160, "El nombre");
        var code = Text.Clean(input.Code, 40)?.ToUpperInvariant();
        if (code is null)
        {
            // Código automático: DD-000123
            var next = (await db.Products.MaxAsync(x => (int?)x.Id) ?? 0) + 1;
            code = $"DD-{next:000000}";
        }
        AppException.ThrowIf(await db.Products.AnyAsync(x => x.Code == code && x.Id != p.Id), $"Ya existe un producto con el código {code}.");
        p.Code = code;
        p.Barcode = Text.Clean(input.Barcode, 40);
        p.Description = Text.Clean(input.Description, 600);
        p.Icon = Text.Clean(input.Icon, 16);
        if (input.CategoryId is not null)
            AppException.ThrowIf(!await db.Categories.AnyAsync(c => c.Id == input.CategoryId), "La categoría no existe.");
        p.CategoryId = input.CategoryId;
        p.Unit = Text.Clean(input.Unit, 12)?.ToUpperInvariant() ?? "UND";
        AppException.ThrowIf(input.TaxRate is not (0 or 15 or 18), "El ISV debe ser 0 %, 15 % o 18 %.");
        p.TaxRate = input.TaxRate;
        SetPrice(db, p, input.Price, by);
        p.CompareAtPrice = input.CompareAtPrice is > 0 ? Money.Round(input.CompareAtPrice.Value) : null;
        p.Active = input.Active;
        p.Featured = input.Featured;
        if (input.UpdateImage) p.ImageData = Text.Image(input.ImageData);
        p.UpdatedAt = DateTime.Now;
    }
}
