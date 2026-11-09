using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Diversify.Delivery.Core;

/// <summary>Crea la base, el usuario master y (solo en desarrollo) datos de demostración.</summary>
public static class DbInitializer
{
    public static async Task InitializeAsync(IServiceProvider services, IConfiguration config)
    {
        using var scope = services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<DeliveryDbContext>();
        var hasher = scope.ServiceProvider.GetRequiredService<IPasswordHasher<User>>();

        await db.Database.EnsureCreatedAsync();
        await db.Database.ExecuteSqlRawAsync("PRAGMA journal_mode=WAL;");
        await SchemaUpgrades.ApplyAsync(db);

        if (!await db.Settings.AnyAsync())
        {
            db.Settings.Add(new StoreSettings { StoreName = config["Seed:StoreName"] ?? "Mi supermercado" });
            await db.SaveChangesAsync();
        }

        if (!await db.Users.AnyAsync(u => u.Role == Roles.Master))
        {
            var master = new User
            {
                Login = (config["Seed:MasterUser"] ?? "master").ToLowerInvariant(),
                FullName = "Administrador",
                Role = Roles.Master,
                Status = AccountStatus.Activo,
            };
            master.PasswordHash = hasher.HashPassword(master, config["Seed:MasterPassword"] ?? "master123");
            db.Users.Add(master);
            await db.SaveChangesAsync();
        }

        if (config.GetValue("Seed:DemoData", false) && !await db.Products.AnyAsync())
            await SeedDemoAsync(db, hasher);
    }

    private static readonly Dictionary<string, string> Emojis = new()
    {
        ["FRU-BAN-01"] = "🍌",
        ["FRU-TOM-01"] = "🍅",
        ["FRU-CEB-01"] = "🧅",
        ["FRU-AGU-01"] = "🥑",
        ["FRU-PAP-01"] = "🥔",
        ["FRU-LIM-01"] = "🍋",
        ["FRU-CHI-01"] = "🫑",
        ["LAC-LEC-01"] = "🥛",
        ["LAC-QUE-01"] = "🧀",
        ["LAC-MAN-01"] = "🧈",
        ["LAC-HUE-01"] = "🥚",
        ["LAC-YOG-01"] = "🍓",
        ["CAR-POL-01"] = "🍗",
        ["CAR-RES-01"] = "🥩",
        ["CAR-CHU-01"] = "🍖",
        ["CAR-SAL-01"] = "🌭",
        ["CAR-JAM-01"] = "🥓",
        ["PAN-MOL-01"] = "🍞",
        ["PAN-TOR-01"] = "🫓",
        ["PAN-SEM-01"] = "🥐",
        ["GRA-FRI-01"] = "🫘",
        ["GRA-ARR-01"] = "🍚",
        ["GRA-AZU-01"] = "🧂",
        ["GRA-ACE-01"] = "🫒",
        ["GRA-HAR-01"] = "🌽",
        ["GRA-CAF-01"] = "☕",
        ["GRA-SAL-01"] = "🧂",
        ["BEB-AGU-01"] = "💧",
        ["BEB-GAS-01"] = "🥤",
        ["BEB-JUG-01"] = "🧃",
        ["BEB-CER-01"] = "🍺",
        ["SNK-PAP-01"] = "🥔",
        ["SNK-GAL-01"] = "🍪",
        ["SNK-CHO-01"] = "🍫",
        ["LIM-DET-01"] = "🧺",
        ["LIM-CLO-01"] = "🧴",
        ["LIM-LAV-01"] = "🧽",
        ["LIM-PAP-01"] = "🧻",
        ["PER-JAB-01"] = "🧼",
        ["PER-SHA-01"] = "🧴",
        ["PER-PAS-01"] = "🪥",
        ["BEB-PAN-01"] = "👶",
        ["BEB-TOA-01"] = "🧻",
    };

    private static async Task SeedDemoAsync(DeliveryDbContext db, IPasswordHasher<User> hasher)
    {
        User NewUser(string login, string name, string role, string password, string? phone = null, string? vehicle = null,
            AccountStatus status = AccountStatus.Activo)
        {
            var u = new User { Login = login, FullName = name, Role = role, Phone = phone, Vehicle = vehicle, Status = status,
                Email = login.Contains('@') ? login : null, OnDuty = role == Roles.Driver };
            u.PasswordHash = hasher.HashPassword(u, password);
            return u;
        }

        var driver1 = NewUser("repartidor", "Carlos Mejía", Roles.Driver, "repartidor123", "9876-5432", "Moto Honda · HAA-1234");
        var driver2 = NewUser("repartidor2", "José Ramírez", Roles.Driver, "repartidor123", "9988-1122", "Moto Yamaha · HBC-8765");
        var customer = NewUser("cliente@demo.hn", "María López", Roles.Customer, "cliente123", "9555-1234");
        var pending = NewUser("ana@demo.hn", "Ana Martínez", Roles.Customer, "cliente123", "3344-5566", status: AccountStatus.EnRevision);
        var customer2 = NewUser("luis@demo.hn", "Luis Fernández", Roles.Customer, "cliente123", "8899-0011");
        db.Users.AddRange(driver1, driver2, customer, pending, customer2);
        await db.SaveChangesAsync();

        db.RegistrationPayments.AddRange(
            new RegistrationPayment { UserId = customer.Id, Method = "Tarjeta", AmountUsd = 5, AmountHnl = 132.50m, GatewayId = "SIM-000101",
                Status = RegistrationPaymentStatus.Aprobado, ReviewedBy = "Pasarela", ReviewedAt = DateTime.Now.AddDays(-12), CreatedAt = DateTime.Now.AddDays(-12) },
            new RegistrationPayment { UserId = customer2.Id, Method = "Tarjeta", AmountUsd = 5, AmountHnl = 132.50m, GatewayId = "SIM-000102",
                Status = RegistrationPaymentStatus.Aprobado, ReviewedBy = "Pasarela", ReviewedAt = DateTime.Now.AddDays(-3), CreatedAt = DateTime.Now.AddDays(-3) },
            new RegistrationPayment { UserId = pending.Id, Method = "Transferencia", AmountUsd = 5, AmountHnl = 132.50m, Reference = "BAC-7781234",
                Status = RegistrationPaymentStatus.EnRevision, CreatedAt = DateTime.Now.AddHours(-2) });

        db.Addresses.AddRange(
            new Address { UserId = customer.Id, Label = "Casa", Line = "Calle 5, casa 23", Neighborhood = "Col. Los Andes", City = "San Pedro Sula",
                Reference = "Portón negro frente a la pulpería Don Chepe", Latitude = 15.5126, Longitude = -88.0127, IsDefault = true },
            new Address { UserId = customer.Id, Label = "Trabajo", Line = "Edificio Torre Morazán, piso 3", Neighborhood = "Blvd. Morazán", City = "San Pedro Sula",
                Reference = "Preguntar en recepción", Latitude = 15.5049, Longitude = -88.0249 },
            new Address { UserId = customer2.Id, Label = "Casa", Line = "Bloque B, casa 14", Neighborhood = "Res. Villas del Campo", City = "San Pedro Sula",
                Reference = "Casa verde de dos pisos", Latitude = 15.5402, Longitude = -88.0350, IsDefault = true });

        var cats = new (string Name, string Icon)[]
        {
            ("Frutas y verduras", "🥬"), ("Lácteos y huevos", "🥛"), ("Carnes y embutidos", "🥩"), ("Panadería", "🍞"),
            ("Granos y abarrotes", "🌾"), ("Bebidas", "🥤"), ("Snacks y dulces", "🍫"), ("Limpieza", "🧽"), ("Cuidado personal", "🧴"), ("Bebé", "🍼"),
        };
        var categories = cats.Select((c, i) => new Category { Name = c.Name, Icon = c.Icon, SortOrder = i }).ToList();
        db.Categories.AddRange(categories);
        await db.SaveChangesAsync();
        Category C(string name) => categories.First(c => c.Name == name);

        var products = new List<Product>();
        void P(string cat, string code, string name, string unit, decimal price, decimal tax = 0, decimal? before = null, bool featured = false, string? desc = null) =>
            products.Add(new Product { CategoryId = C(cat).Id, Code = code, Name = name, Unit = unit, Price = price, TaxRate = tax,
                CompareAtPrice = before, Featured = featured, Description = desc, Icon = Emojis.GetValueOrDefault(code) });

        P("Frutas y verduras", "FRU-BAN-01", "Banano maduro", "LB", 8.50m, featured: true);
        P("Frutas y verduras", "FRU-TOM-01", "Tomate de cocina", "LB", 14.00m);
        P("Frutas y verduras", "FRU-CEB-01", "Cebolla blanca", "LB", 18.00m);
        P("Frutas y verduras", "FRU-AGU-01", "Aguacate hass", "UND", 25.00m, before: 30m, featured: true);
        P("Frutas y verduras", "FRU-PAP-01", "Papa lavada", "LB", 16.50m);
        P("Frutas y verduras", "FRU-LIM-01", "Limón persa (bolsa 10)", "BOL", 20.00m);
        P("Frutas y verduras", "FRU-CHI-01", "Chile dulce", "UND", 7.00m);
        P("Lácteos y huevos", "LAC-LEC-01", "Leche entera Sula 1 L", "UND", 32.00m, featured: true);
        P("Lácteos y huevos", "LAC-QUE-01", "Queso semiseco", "LB", 85.00m);
        P("Lácteos y huevos", "LAC-MAN-01", "Mantequilla crema 450 g", "UND", 48.00m);
        P("Lácteos y huevos", "LAC-HUE-01", "Huevos blancos (cartón 30)", "CTN", 135.00m, before: 150m, featured: true);
        P("Lácteos y huevos", "LAC-YOG-01", "Yogurt de fresa 1 L", "UND", 55.00m, 15);
        P("Carnes y embutidos", "CAR-POL-01", "Pechuga de pollo", "LB", 62.00m, featured: true);
        P("Carnes y embutidos", "CAR-RES-01", "Carne molida de res", "LB", 95.00m);
        P("Carnes y embutidos", "CAR-CHU-01", "Chuleta de cerdo", "LB", 78.00m);
        P("Carnes y embutidos", "CAR-SAL-01", "Salchicha de pavo 454 g", "UND", 58.00m, 15);
        P("Carnes y embutidos", "CAR-JAM-01", "Jamón de pavo 250 g", "UND", 64.00m, 15);
        P("Panadería", "PAN-MOL-01", "Pan molde blanco grande", "UND", 52.00m);
        P("Panadería", "PAN-TOR-01", "Tortillas de maíz (paquete 10)", "PAQ", 20.00m);
        P("Panadería", "PAN-SEM-01", "Semita de yema", "UND", 15.00m);
        P("Granos y abarrotes", "GRA-FRI-01", "Frijol rojo 2 lb", "BOL", 46.00m, featured: true);
        P("Granos y abarrotes", "GRA-ARR-01", "Arroz blanco 4 lb", "BOL", 62.00m);
        P("Granos y abarrotes", "GRA-AZU-01", "Azúcar blanca 5 lb", "BOL", 70.00m);
        P("Granos y abarrotes", "GRA-ACE-01", "Aceite vegetal 1 L", "UND", 68.00m, before: 75m);
        P("Granos y abarrotes", "GRA-HAR-01", "Harina de maíz 2 lb", "BOL", 30.00m);
        P("Granos y abarrotes", "GRA-CAF-01", "Café molido 400 g", "UND", 95.00m, 15);
        P("Granos y abarrotes", "GRA-SAL-01", "Sal yodada 1 kg", "UND", 12.00m);
        P("Bebidas", "BEB-AGU-01", "Agua purificada 5 galones", "UND", 45.00m);
        P("Bebidas", "BEB-GAS-01", "Gaseosa cola 3 L", "UND", 62.00m, 15, featured: true);
        P("Bebidas", "BEB-JUG-01", "Jugo de naranja 1.89 L", "UND", 58.00m, 15);
        P("Bebidas", "BEB-CER-01", "Cerveza nacional (6 latas)", "PAQ", 185.00m, 18);
        P("Snacks y dulces", "SNK-PAP-01", "Papas fritas familiar", "UND", 42.00m, 15);
        P("Snacks y dulces", "SNK-GAL-01", "Galletas de chocolate", "UND", 28.00m, 15);
        P("Snacks y dulces", "SNK-CHO-01", "Chocolate de leche 100 g", "UND", 35.00m, 15);
        P("Limpieza", "LIM-DET-01", "Detergente en polvo 1 kg", "UND", 72.00m, 15);
        P("Limpieza", "LIM-CLO-01", "Cloro 1 galón", "UND", 55.00m, 15, before: 62m);
        P("Limpieza", "LIM-LAV-01", "Lavaplatos en crema 900 g", "UND", 48.00m, 15);
        P("Limpieza", "LIM-PAP-01", "Papel higiénico (12 rollos)", "PAQ", 115.00m, 15);
        P("Cuidado personal", "PER-JAB-01", "Jabón de baño (3 unidades)", "PAQ", 45.00m, 15);
        P("Cuidado personal", "PER-SHA-01", "Shampoo 750 ml", "UND", 98.00m, 15);
        P("Cuidado personal", "PER-PAS-01", "Pasta dental 100 ml", "UND", 38.00m, 15);
        P("Bebé", "BEB-PAN-01", "Pañales etapa 3 (40 unidades)", "PAQ", 285.00m, 15);
        P("Bebé", "BEB-TOA-01", "Toallitas húmedas (80)", "PAQ", 65.00m, 15);
        db.Products.AddRange(products);
        await db.SaveChangesAsync();

        // Pedidos de ejemplo en distintos estados, para ver el tablero y la app del repartidor con datos.
        var settings = await db.Settings.OrderBy(x => x.Id).FirstAsync();
        settings.OpensAt = settings.ClosesAt = "00:00"; // demo: abierta 24 horas
        settings.StorePhone = "2550-0000";
        settings.BankInstructions = "BAC Credomatic · Cuenta de ahorro 000000000 · A nombre de: Súper La Esperanza (datos de ejemplo)";
        settings.StoreAddress = "Barrio Guamilito, 6 calle, San Pedro Sula";
        var home = await db.Addresses.FirstAsync(a => a.UserId == customer.Id && a.IsDefault);
        var home2 = await db.Addresses.FirstAsync(a => a.UserId == customer2.Id);
        Product Pr(string code) => products.First(p => p.Code == code);
        var seq = 0;
        Order NewOrder(User who, Address addr, OrderStatus status, int minutesAgo, PaymentMethod method, string? instructions,
            User? driver, params (string Code, decimal Qty)[] lines)
        {
            var o = new Order
            {
                Number = $"DD-{++seq:000000}", CustomerId = who.Id, DriverId = driver?.Id, Status = status,
                DeliveryName = who.FullName, DeliveryPhone = who.Phone ?? "", AddressLine = addr.Line, Neighborhood = addr.Neighborhood,
                City = addr.City, Reference = addr.Reference, Latitude = addr.Latitude, Longitude = addr.Longitude,
                Instructions = instructions, PaymentMethod = method, DeliveryPin = Random.Shared.Next(1000, 9999).ToString(),
                CreatedAt = DateTime.Now.AddMinutes(-minutesAgo), UpdatedAt = DateTime.Now.AddMinutes(-minutesAgo / 2),
            };
            foreach (var (code, q) in lines)
            {
                var p = Pr(code);
                o.Items.Add(new OrderItem { ProductId = p.Id, Code = p.Code, Name = p.Name, Unit = p.Unit, Icon = p.Icon, Price = p.Price, Quantity = q });
            }
            o.Subtotal = o.Items.Sum(i => i.LineTotal);
            o.DeliveryFee = settings.FreeDeliveryFrom > 0 && o.Subtotal >= settings.FreeDeliveryFrom ? 0 : settings.DeliveryFee;
            o.Total = o.Subtotal + o.DeliveryFee;
            if (method == PaymentMethod.Efectivo) o.CashGiven = Math.Ceiling(o.Total / 100) * 100;
            o.Events.Add(new OrderEvent { Status = OrderStatus.Recibido, Message = "Pedido recibido.", By = who.FullName, At = o.CreatedAt });
            if (status >= OrderStatus.Preparando && status != OrderStatus.Cancelado)
                o.Events.Add(new OrderEvent { Status = OrderStatus.Preparando, Message = "Estamos armando tu pedido.", By = "Administrador", At = o.CreatedAt.AddMinutes(5) });
            if (status >= OrderStatus.Listo && status != OrderStatus.Cancelado)
                o.Events.Add(new OrderEvent { Status = OrderStatus.Listo, Message = "Pedido listo para salir.", By = "Administrador", At = o.CreatedAt.AddMinutes(20) });
            if (status >= OrderStatus.EnCamino && status != OrderStatus.Cancelado)
                o.Events.Add(new OrderEvent { Status = OrderStatus.EnCamino, Message = $"{driver?.FullName} va en camino.", By = driver?.FullName ?? "", At = o.CreatedAt.AddMinutes(25) });
            if (status == OrderStatus.Entregado)
            {
                o.DeliveredAt = o.CreatedAt.AddMinutes(45);
                o.Events.Add(new OrderEvent { Status = OrderStatus.Entregado, Message = "Pedido entregado.", By = driver?.FullName ?? "", At = o.DeliveredAt.Value });
            }
            return o;
        }

        db.Orders.AddRange(
            NewOrder(customer, home, OrderStatus.Entregado, 60 * 26, PaymentMethod.Efectivo, null, driver1,
                ("LAC-LEC-01", 4), ("PAN-MOL-01", 1), ("LAC-HUE-01", 1), ("GRA-FRI-01", 2)),
            NewOrder(customer2, home2, OrderStatus.Entregado, 60 * 5, PaymentMethod.Tarjeta, "Llamar al llegar.", driver2,
                ("CAR-POL-01", 3), ("FRU-TOM-01", 2), ("FRU-CEB-01", 1), ("BEB-GAS-01", 2)),
            NewOrder(customer, home, OrderStatus.EnCamino, 35, PaymentMethod.Efectivo, "Tocar el timbre dos veces. Hay perro, pero no muerde.", driver1,
                ("FRU-BAN-01", 3), ("FRU-AGU-01", 2), ("LAC-QUE-01", 1), ("PAN-TOR-01", 2), ("BEB-AGU-01", 1)),
            NewOrder(customer2, home2, OrderStatus.Listo, 22, PaymentMethod.Transferencia, "Dejar con el guardia de la residencial.", null,
                ("GRA-ARR-01", 1), ("GRA-ACE-01", 1), ("GRA-AZU-01", 1), ("LIM-DET-01", 1), ("LIM-PAP-01", 1)),
            NewOrder(customer, home, OrderStatus.Preparando, 12, PaymentMethod.Efectivo, "Si no hay aguacate hass, cualquier aguacate maduro.", null,
                ("FRU-AGU-01", 3), ("CAR-RES-01", 2), ("LAC-YOG-01", 1), ("SNK-PAP-01", 2)),
            NewOrder(customer2, home2, OrderStatus.Recibido, 3, PaymentMethod.Efectivo, null, null,
                ("BEB-CER-01", 2), ("SNK-PAP-01", 3), ("BEB-GAS-01", 1), ("FRU-LIM-01", 1)));
        await db.SaveChangesAsync();
    }
}

