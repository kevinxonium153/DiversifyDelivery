using System.Security.Claims;
using Diversify.Delivery.Core;
using Microsoft.EntityFrameworkCore;

namespace Diversify.Delivery.Modules;

public record AddressInput(string Label, string Line, string? Neighborhood, string? City, string? Reference,
    double? Latitude, double? Longitude, bool IsDefault = false);
public record OrderLineInput(int ProductId, decimal Quantity, string? Note);
public record OrderInput(int AddressId, List<OrderLineInput> Items, string? Instructions, bool AllowSubstitutions,
    PaymentMethod PaymentMethod, decimal? CashGiven, string? PaymentReference);
public record StatusInput(OrderStatus Status, string? Message);
public record AssignInput(int? DriverId);
public record CancelInput(string? Reason);
public record FulfillInput(List<FulfillLine> Items);
public record FulfillLine(int Id, decimal? FulfilledQuantity);
public record DeliverInput(string Pin);
public record DutyInput(bool OnDuty);

public record OrderItemDto(int Id, int ProductId, string Code, string Name, string Unit, string? Icon, decimal Price, decimal Quantity,
    decimal? FulfilledQuantity, decimal LineTotal, string? Note);
public record OrderEventDto(string Status, string Message, string By, DateTime At);
public record OrderDto(int Id, string Number, string Status, DateTime CreatedAt, DateTime UpdatedAt, DateTime? DeliveredAt,
    int CustomerId, string DeliveryName, string DeliveryPhone, string AddressLine, string? Neighborhood, string City, string? Reference,
    double? Latitude, double? Longitude, string? Instructions, bool AllowSubstitutions,
    string PaymentMethod, decimal? CashGiven, decimal? Change, string? PaymentReference,
    decimal Subtotal, decimal DeliveryFee, decimal Total, int? DriverId, string? DriverName, string? DriverPhone, string? DriverVehicle,
    string? DeliveryPin, string? CancelReason, int ItemCount, List<OrderItemDto>? Items, List<OrderEventDto>? Events);

/// <summary>Reglas de los pedidos, compartidas por cliente, master y repartidor.</summary>
public static class Orders
{
    public static readonly Dictionary<OrderStatus, string> StatusMessages = new()
    {
        [OrderStatus.Recibido] = "Pedido recibido.",
        [OrderStatus.Preparando] = "Estamos armando tu pedido.",
        [OrderStatus.Listo] = "Pedido listo, esperando repartidor.",
        [OrderStatus.EnCamino] = "Tu pedido va en camino.",
        [OrderStatus.Entregado] = "Pedido entregado. ¡Gracias por tu compra!",
        [OrderStatus.Cancelado] = "Pedido cancelado.",
    };

    public static bool IsOpen(StoreSettings s)
    {
        if (!s.AcceptingOrders) return false;
        if (!TimeOnly.TryParse(s.OpensAt, out var open) || !TimeOnly.TryParse(s.ClosesAt, out var close)) return true;
        if (open == close) return true; // misma hora de apertura y cierre = 24 horas
        var now = TimeOnly.FromDateTime(DateTime.Now);
        return open <= close ? now >= open && now < close : now >= open || now < close;
    }

    public static IQueryable<Order> WithDetails(this IQueryable<Order> q) =>
        q.Include(o => o.Items).Include(o => o.Events).Include(o => o.Driver);

    /// <summary>
    /// <paramref name="includePin"/>: el PIN de entrega lo ven el cliente y el master. El repartidor NO: se lo dicta
    /// el cliente al recibir, y así se comprueba que el pedido llegó a la persona correcta.
    /// </summary>
    public static OrderDto ToDto(Order o, bool includePin, bool details = true) =>
        new(o.Id, o.Number, o.Status.ToString(), o.CreatedAt, o.UpdatedAt, o.DeliveredAt,
            o.CustomerId, o.DeliveryName, o.DeliveryPhone, o.AddressLine, o.Neighborhood, o.City, o.Reference,
            o.Latitude, o.Longitude, o.Instructions, o.AllowSubstitutions,
            o.PaymentMethod.ToString(), o.CashGiven, o.CashGiven is > 0 ? Money.Round(o.CashGiven.Value - o.Total) : null, o.PaymentReference,
            o.Subtotal, o.DeliveryFee, o.Total, o.DriverId, o.Driver?.FullName, o.Driver?.Phone, o.Driver?.Vehicle,
            includePin ? o.DeliveryPin : null, o.CancelReason, o.Items.Count,
            details ? o.Items.OrderBy(i => i.Id).Select(i => new OrderItemDto(i.Id, i.ProductId, i.Code, i.Name, i.Unit, i.Icon, i.Price, i.Quantity,
                i.FulfilledQuantity, i.LineTotal, i.Note)).ToList() : null,
            details ? o.Events.OrderBy(e => e.At).Select(e => new OrderEventDto(e.Status.ToString(), e.Message, e.By, e.At)).ToList() : null);

    public static void AddEvent(Order o, OrderStatus status, string? message, string by)
    {
        o.Status = status;
        o.UpdatedAt = DateTime.Now;
        if (status == OrderStatus.Entregado) o.DeliveredAt = DateTime.Now;
        o.Events.Add(new OrderEvent { Status = status, Message = Text.Clean(message, 300) ?? StatusMessages[status], By = by });
    }

    public static void Recalculate(Order o, StoreSettings s)
    {
        o.Subtotal = Money.Round(o.Items.Sum(i => i.LineTotal));
        o.DeliveryFee = s.FreeDeliveryFrom > 0 && o.Subtotal >= s.FreeDeliveryFrom ? 0 : s.DeliveryFee;
        o.Total = o.Subtotal + o.DeliveryFee;
    }

    /// <summary>Transiciones que puede hacer el master desde el tablero.</summary>
    private static readonly Dictionary<OrderStatus, OrderStatus[]> MasterTransitions = new()
    {
        [OrderStatus.Recibido] = [OrderStatus.Preparando],
        [OrderStatus.Preparando] = [OrderStatus.Listo, OrderStatus.Recibido],
        [OrderStatus.Listo] = [OrderStatus.EnCamino, OrderStatus.Preparando],
        [OrderStatus.EnCamino] = [OrderStatus.Entregado, OrderStatus.Listo],
    };

    public static void Map(RouteGroupBuilder api)
    {
        MapAddresses(api);
        MapCustomer(api);
        MapMaster(api);
        MapDriver(api);
    }

    // ---------- Direcciones del cliente ----------
    private static void MapAddresses(RouteGroupBuilder api)
    {
        var g = api.MapGroup("/addresses").RequireRoles(Roles.Customer);

        g.MapGet("/", async (ClaimsPrincipal me, DeliveryDbContext db) =>
            await db.Addresses.AsNoTracking().Where(a => a.UserId == me.UserId()).OrderByDescending(a => a.IsDefault).ThenBy(a => a.Id).ToListAsync());

        g.MapPost("/", async (AddressInput input, ClaimsPrincipal me, DeliveryDbContext db) =>
        {
            var userId = me.UserId();
            AppException.ThrowIf(await db.Addresses.CountAsync(a => a.UserId == userId) >= 10, "Puedes guardar hasta 10 direcciones.");
            var a = new Address { UserId = userId };
            await ApplyAddressAsync(db, a, input);
            db.Addresses.Add(a);
            await db.SaveChangesAsync();
            return Results.Created($"/api/addresses/{a.Id}", a);
        });

        g.MapPut("/{id:int}", async (int id, AddressInput input, ClaimsPrincipal me, DeliveryDbContext db) =>
        {
            var a = await db.Addresses.FirstOrDefaultAsync(x => x.Id == id && x.UserId == me.UserId()) ?? throw AppException.NotFound("Dirección");
            await ApplyAddressAsync(db, a, input);
            await db.SaveChangesAsync();
            return a;
        });

        g.MapDelete("/{id:int}", async (int id, ClaimsPrincipal me, DeliveryDbContext db) =>
        {
            var a = await db.Addresses.FirstOrDefaultAsync(x => x.Id == id && x.UserId == me.UserId()) ?? throw AppException.NotFound("Dirección");
            db.Addresses.Remove(a);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });
    }

    private static async Task ApplyAddressAsync(DeliveryDbContext db, Address a, AddressInput input)
    {
        a.Label = Text.Clean(input.Label, 40) ?? "Casa";
        a.Line = Text.Required(input.Line, 200, "La dirección");
        a.Neighborhood = Text.Clean(input.Neighborhood, 100);
        a.City = Text.Clean(input.City, 60) ?? "San Pedro Sula";
        a.Reference = Text.Clean(input.Reference, 300);
        var hasCoords = input.Latitude is not null && input.Longitude is not null;
        // Honduras está aprox. entre 12.9–17.5 N y 89.4–83.1 O.
        AppException.ThrowIf(hasCoords && (input.Latitude is < 12 or > 18 || input.Longitude is < -90 or > -83),
            "La ubicación marcada está fuera de Honduras. Vuelve a marcarla.");
        a.Latitude = hasCoords ? Math.Round(input.Latitude!.Value, 6) : null;
        a.Longitude = hasCoords ? Math.Round(input.Longitude!.Value, 6) : null;
        var isFirst = !await db.Addresses.AnyAsync(x => x.UserId == a.UserId && x.Id != a.Id);
        a.IsDefault = input.IsDefault || isFirst;
        if (a.IsDefault)
            await db.Addresses.Where(x => x.UserId == a.UserId && x.Id != a.Id && x.IsDefault)
                .ExecuteUpdateAsync(s => s.SetProperty(x => x.IsDefault, false));
    }

    // ---------- Cliente ----------
    private static void MapCustomer(RouteGroupBuilder api)
    {
        var g = api.MapGroup("/orders").RequireRoles(Roles.Customer);

        g.MapPost("/", async (OrderInput input, ClaimsPrincipal me, DeliveryDbContext db) =>
        {
            var user = await db.Users.FindAsync(me.UserId()) ?? throw AppException.NotFound("Usuario");
            AppException.ThrowIf(user.Status != AccountStatus.Activo,
                user.Status == AccountStatus.EnRevision
                    ? "Estamos verificando el pago de tu inscripción. Podrás pedir en cuanto se apruebe."
                    : "Para hacer pedidos primero paga la inscripción de tu cuenta.");
            var s = await db.Settings.OrderBy(x => x.Id).FirstAsync();
            AppException.ThrowIf(!s.AcceptingOrders, "La tienda no está recibiendo pedidos en este momento.");
            AppException.ThrowIf(!IsOpen(s), $"La tienda recibe pedidos de {s.OpensAt} a {s.ClosesAt}.");
            AppException.ThrowIf(input.Items is not { Count: > 0 }, "El carrito está vacío.");
            AppException.ThrowIf(input.Items.Count > 100, "Un pedido puede tener hasta 100 productos distintos.");
            AppException.ThrowIf(await db.Orders.CountAsync(o => o.CustomerId == user.Id && o.Status == OrderStatus.Recibido) >= 3,
                "Tienes 3 pedidos sin atender. Espera a que el supermercado los revise.");

            var addr = await db.Addresses.FirstOrDefaultAsync(a => a.Id == input.AddressId && a.UserId == user.Id)
                       ?? throw new AppException("Elige una dirección de entrega.");

            var ids = input.Items.Select(i => i.ProductId).Distinct().ToList();
            var products = await db.Products.Include(p => p.Category).Where(p => ids.Contains(p.Id)).ToDictionaryAsync(p => p.Id);
            var order = new Order
            {
                CustomerId = user.Id, DeliveryName = user.FullName, DeliveryPhone = user.Phone ?? "",
                AddressLine = addr.Line, Neighborhood = addr.Neighborhood, City = addr.City, Reference = addr.Reference,
                Latitude = addr.Latitude, Longitude = addr.Longitude,
                Instructions = Text.Clean(input.Instructions, 500), AllowSubstitutions = input.AllowSubstitutions,
                PaymentMethod = input.PaymentMethod, PaymentReference = Text.Clean(input.PaymentReference, 80),
                DeliveryPin = Random.Shared.Next(1000, 10000).ToString(),
            };
            foreach (var line in input.Items.GroupBy(i => i.ProductId))
            {
                var qty = line.Sum(i => i.Quantity);
                AppException.ThrowIf(qty <= 0 || qty > 999, "Revisa las cantidades del carrito.");
                AppException.ThrowIf(!products.TryGetValue(line.Key, out var p) || !p.Active, "Un producto del carrito ya no está disponible. Revisa tu carrito.");
                AppException.ThrowIf(p!.Stock is <= 0, $"{p.Name} está agotado.");
                AppException.ThrowIf(qty != Math.Floor(qty) && p.Unit is not ("LB" or "KG"), $"{p.Name} se vende por unidad.");
                order.Items.Add(new OrderItem { ProductId = p.Id, Code = p.Code, Name = p.Name, Unit = p.Unit, Icon = p.Icon ?? p.Category?.Icon, Price = p.Price, Quantity = qty,
                    Note = Text.Clean(line.First().Note, 200) });
            }
            Recalculate(order, s);
            AppException.ThrowIf(s.MinimumOrder > 0 && order.Subtotal < s.MinimumOrder, $"El pedido mínimo es L {s.MinimumOrder:N2} (sin envío).");
            if (input.PaymentMethod == PaymentMethod.Efectivo && input.CashGiven is > 0)
            {
                AppException.ThrowIf(input.CashGiven < order.Total, "El efectivo con el que pagarás es menor que el total.");
                order.CashGiven = Money.Round(input.CashGiven.Value);
            }
            AddEvent(order, OrderStatus.Recibido, null, user.FullName);

            // Número correlativo DD-000001 (dentro de una transacción para que no se repita).
            await using var tx = await db.Database.BeginTransactionAsync();
            var last = await db.Orders.MaxAsync(o => (int?)o.Id) ?? 0;
            order.Number = $"DD-{last + 1:000000}";
            db.Orders.Add(order);
            await db.SaveChangesAsync();
            await tx.CommitAsync();
            return Results.Created($"/api/orders/{order.Id}", ToDto(order, includePin: true));
        });

        g.MapGet("/", async (ClaimsPrincipal me, DeliveryDbContext db) =>
        {
            var list = await db.Orders.AsNoTracking().WithDetails().Where(o => o.CustomerId == me.UserId())
                .OrderByDescending(o => o.Id).Take(50).ToListAsync();
            return list.Select(o => ToDto(o, includePin: true));
        });

        g.MapGet("/{id:int}", async (int id, ClaimsPrincipal me, DeliveryDbContext db) =>
        {
            var o = await db.Orders.AsNoTracking().WithDetails().FirstOrDefaultAsync(x => x.Id == id && x.CustomerId == me.UserId())
                    ?? throw AppException.NotFound("Pedido");
            return ToDto(o, includePin: true);
        });

        g.MapPost("/{id:int}/cancel", async (int id, CancelInput input, ClaimsPrincipal me, DeliveryDbContext db) =>
        {
            var o = await db.Orders.WithDetails().FirstOrDefaultAsync(x => x.Id == id && x.CustomerId == me.UserId()) ?? throw AppException.NotFound("Pedido");
            AppException.ThrowIf(o.Status != OrderStatus.Recibido, "El pedido ya se está preparando. Llama al supermercado para cancelarlo.");
            o.CancelReason = Text.Clean(input.Reason, 300) ?? "Cancelado por el cliente.";
            AddEvent(o, OrderStatus.Cancelado, o.CancelReason, me.DisplayName());
            await db.SaveChangesAsync();
            return ToDto(o, includePin: true);
        });
    }

    // ---------- Master ----------
    private static void MapMaster(RouteGroupBuilder api)
    {
        var g = api.MapGroup("/admin/orders").RequireRoles(Roles.Master);

        g.MapGet("/", async (DeliveryDbContext db, string? status, DateOnly? date, string? search) =>
        {
            var q = db.Orders.AsNoTracking().WithDetails();
            if (status == "activos") q = q.Where(o => o.Status != OrderStatus.Entregado && o.Status != OrderStatus.Cancelado);
            else if (Enum.TryParse<OrderStatus>(status, true, out var st)) q = q.Where(o => o.Status == st);
            if (date is not null)
            {
                var start = date.Value.ToDateTime(TimeOnly.MinValue);
                q = q.Where(o => o.CreatedAt >= start && o.CreatedAt < start.AddDays(1));
            }
            if (!string.IsNullOrWhiteSpace(search))
            {
                var s = search.Trim().ToLower();
                q = q.Where(o => o.Number.ToLower().Contains(s) || o.DeliveryName.ToLower().Contains(s) || o.DeliveryPhone.Contains(s));
            }
            var list = await q.OrderByDescending(o => o.Id).Take(300).ToListAsync();
            return list.Select(o => ToDto(o, includePin: true));
        });

        g.MapGet("/{id:int}", async (int id, DeliveryDbContext db) =>
        {
            var o = await db.Orders.AsNoTracking().WithDetails().FirstOrDefaultAsync(x => x.Id == id) ?? throw AppException.NotFound("Pedido");
            return ToDto(o, includePin: true);
        });

        g.MapPost("/{id:int}/status", async (int id, StatusInput input, ClaimsPrincipal me, DeliveryDbContext db) =>
        {
            var o = await db.Orders.WithDetails().FirstOrDefaultAsync(x => x.Id == id) ?? throw AppException.NotFound("Pedido");
            AppException.ThrowIf(!MasterTransitions.TryGetValue(o.Status, out var allowed) || !allowed.Contains(input.Status),
                $"No se puede pasar de {o.Status} a {input.Status}.");
            AppException.ThrowIf(input.Status == OrderStatus.EnCamino && o.DriverId is null, "Asigna un repartidor antes de despacharlo.");
            AddEvent(o, input.Status, input.Message, me.DisplayName());
            await db.SaveChangesAsync();
            return ToDto(o, includePin: true);
        });

        g.MapPost("/{id:int}/assign", async (int id, AssignInput input, ClaimsPrincipal me, DeliveryDbContext db) =>
        {
            var o = await db.Orders.WithDetails().FirstOrDefaultAsync(x => x.Id == id) ?? throw AppException.NotFound("Pedido");
            AppException.ThrowIf(o.Status is OrderStatus.Entregado or OrderStatus.Cancelado, "El pedido ya está cerrado.");
            User? driver = null;
            if (input.DriverId is not null)
            {
                driver = await db.Users.FirstOrDefaultAsync(u => u.Id == input.DriverId && u.Role == Roles.Driver && u.Status == AccountStatus.Activo)
                         ?? throw new AppException("El repartidor no existe o está inactivo.");
            }
            o.DriverId = driver?.Id;
            o.Driver = driver;
            o.UpdatedAt = DateTime.Now;
            o.Events.Add(new OrderEvent { Status = o.Status, By = me.DisplayName(),
                Message = driver is null ? "Se quitó el repartidor." : $"Repartidor asignado: {driver.FullName}." });
            await db.SaveChangesAsync();
            return ToDto(o, includePin: true);
        });

        // Al armar el pedido: marcar productos que no hay (0) o con otra cantidad. Recalcula el total.
        g.MapPut("/{id:int}/items", async (int id, FulfillInput input, ClaimsPrincipal me, DeliveryDbContext db) =>
        {
            var o = await db.Orders.WithDetails().FirstOrDefaultAsync(x => x.Id == id) ?? throw AppException.NotFound("Pedido");
            AppException.ThrowIf(o.Status is not (OrderStatus.Recibido or OrderStatus.Preparando), "Solo se ajusta mientras se arma el pedido.");
            var changes = new List<string>();
            foreach (var line in input.Items)
            {
                var item = o.Items.FirstOrDefault(i => i.Id == line.Id) ?? throw AppException.NotFound("Línea");
                var q = line.FulfilledQuantity;
                AppException.ThrowIf(q is < 0, "La cantidad no puede ser negativa.");
                if (q == item.Quantity) q = null;
                if (q == item.FulfilledQuantity) continue;
                item.FulfilledQuantity = q;
                changes.Add(q == 0 ? $"{item.Name}: no disponible" : $"{item.Name}: {q ?? item.Quantity} {item.Unit}");
            }
            if (changes.Count > 0)
            {
                Recalculate(o, await db.Settings.OrderBy(x => x.Id).FirstAsync());
                o.UpdatedAt = DateTime.Now;
                o.Events.Add(new OrderEvent { Status = o.Status, By = me.DisplayName(), Message = "Ajuste: " + string.Join("; ", changes) });
                await db.SaveChangesAsync();
            }
            return ToDto(o, includePin: true);
        });

        g.MapPost("/{id:int}/cancel", async (int id, CancelInput input, ClaimsPrincipal me, DeliveryDbContext db) =>
        {
            var o = await db.Orders.WithDetails().FirstOrDefaultAsync(x => x.Id == id) ?? throw AppException.NotFound("Pedido");
            AppException.ThrowIf(o.Status is OrderStatus.Entregado or OrderStatus.Cancelado, "El pedido ya está cerrado.");
            o.CancelReason = Text.Required(input.Reason, 300, "El motivo");
            AddEvent(o, OrderStatus.Cancelado, $"Cancelado: {o.CancelReason}", me.DisplayName());
            await db.SaveChangesAsync();
            return ToDto(o, includePin: true);
        });

        api.MapGet("/admin/dashboard", async (DeliveryDbContext db) =>
        {
            var today = DateTime.Today;
            var orders = await db.Orders.AsNoTracking().Where(o => o.CreatedAt >= today.AddDays(-7) || o.DeliveredAt >= today.AddDays(-6)).ToListAsync();
            var todays = orders.Where(o => o.CreatedAt >= today && o.Status != OrderStatus.Cancelado).ToList();
            var deliveredToday = orders.Where(o => o.DeliveredAt >= today).ToList();
            // Abiertos: todos. Cerrados (entregados/cancelados): solo los de hoy.
            var byStatus = Enum.GetValues<OrderStatus>().ToDictionary(s => s.ToString(),
                s => db.Orders.Count(o => o.Status == s && (s != OrderStatus.Entregado && s != OrderStatus.Cancelado || o.UpdatedAt >= today)));
            var deliveredWeek = orders.Where(o => o.DeliveredAt is not null).ToList();
            return new
            {
                ordersToday = todays.Count,
                salesToday = deliveredToday.Sum(o => o.Total),
                pipelineToday = todays.Sum(o => o.Total),
                avgTicket = todays.Count > 0 ? Money.Round(todays.Sum(o => o.Total) / todays.Count) : 0,
                avgDeliveryMinutes = deliveredWeek.Count > 0 ? Math.Round(deliveredWeek.Average(o => (o.DeliveredAt!.Value - o.CreatedAt).TotalMinutes)) : 0,
                byStatus,
                pendingRegistrations = await db.RegistrationPayments.CountAsync(p => p.Status == RegistrationPaymentStatus.EnRevision),
                activeCustomers = await db.Users.CountAsync(u => u.Role == Roles.Customer && u.Status == AccountStatus.Activo),
                driversOnDuty = await db.Users.CountAsync(u => u.Role == Roles.Driver && u.OnDuty && u.Status == AccountStatus.Activo),
                last7 = Enumerable.Range(0, 7).Select(i => today.AddDays(i - 6)).Select(d => new
                {
                    date = DateOnly.FromDateTime(d),
                    orders = orders.Count(o => o.CreatedAt.Date == d && o.Status != OrderStatus.Cancelado),
                    sales = orders.Where(o => o.DeliveredAt?.Date == d).Sum(o => o.Total),
                }),
            };
        }).RequireRoles(Roles.Master);
    }

    // ---------- Repartidor ----------
    private static void MapDriver(RouteGroupBuilder api)
    {
        var g = api.MapGroup("/driver").RequireRoles(Roles.Driver);

        g.MapGet("/orders", async (ClaimsPrincipal me, DeliveryDbContext db, string? scope) =>
        {
            var id = me.UserId();
            var q = db.Orders.AsNoTracking().WithDetails();
            q = scope switch
            {
                // Disponibles: listos o armándose, sin repartidor.
                "available" => q.Where(o => o.DriverId == null && (o.Status == OrderStatus.Listo || o.Status == OrderStatus.Preparando)),
                "history" => q.Where(o => o.DriverId == id && (o.Status == OrderStatus.Entregado || o.Status == OrderStatus.Cancelado)
                                          && o.UpdatedAt >= DateTime.Today.AddDays(-30)),
                _ => q.Where(o => o.DriverId == id && o.Status != OrderStatus.Entregado && o.Status != OrderStatus.Cancelado),
            };
            var list = await q.OrderBy(o => o.CreatedAt).Take(100).ToListAsync();
            if (scope == "history") list.Reverse();
            return list.Select(o => ToDto(o, includePin: false));
        });

        g.MapGet("/orders/{id:int}", async (int id, ClaimsPrincipal me, DeliveryDbContext db) =>
        {
            // La consulta por ID respeta la misma disponibilidad que el listado: un ID conocido no da acceso.
            var o = await db.Orders.AsNoTracking().WithDetails().FirstOrDefaultAsync(x => x.Id == id &&
                    (x.DriverId == me.UserId() || (x.DriverId == null &&
                        (x.Status == OrderStatus.Preparando || x.Status == OrderStatus.Listo))))
                    ?? throw AppException.NotFound("Pedido");
            return ToDto(o, includePin: false);
        });

        g.MapPost("/orders/{id:int}/take", async (int id, ClaimsPrincipal me, DeliveryDbContext db) =>
        {
            var o = await db.Orders.WithDetails().FirstOrDefaultAsync(x => x.Id == id) ?? throw AppException.NotFound("Pedido");
            AppException.ThrowIf(o.DriverId is not null && o.DriverId != me.UserId(), "Otro repartidor ya tomó este pedido.");
            AppException.ThrowIf(o.Status is not (OrderStatus.Preparando or OrderStatus.Listo), "Este pedido ya no está disponible.");
            var driver = await db.Users.FindAsync(me.UserId());
            o.DriverId = driver!.Id;
            o.Driver = driver;
            o.UpdatedAt = DateTime.Now;
            o.Events.Add(new OrderEvent { Status = o.Status, By = driver.FullName, Message = $"{driver.FullName} tomó el pedido." });
            await db.SaveChangesAsync();
            return ToDto(o, includePin: false);
        });

        g.MapPost("/orders/{id:int}/release", async (int id, ClaimsPrincipal me, DeliveryDbContext db) =>
        {
            // Mantener lectura, validación y escritura juntas: no soltar un pedido que se cerró en paralelo.
            await using var tx = await db.Database.BeginTransactionAsync();
            var o = await db.Orders.WithDetails().FirstOrDefaultAsync(x => x.Id == id && x.DriverId == me.UserId()) ?? throw AppException.NotFound("Pedido");
            AppException.ThrowIf(o.Status == OrderStatus.EnCamino, "El pedido ya va en camino: avisa al supermercado.");
            AppException.ThrowIf(o.Status is not (OrderStatus.Preparando or OrderStatus.Listo),
                "Solo puedes soltar pedidos que se estén preparando o estén listos. Los pedidos cerrados conservan su repartidor.");
            o.DriverId = null;
            o.Driver = null;
            o.UpdatedAt = DateTime.Now;
            o.Events.Add(new OrderEvent { Status = o.Status, By = me.DisplayName(), Message = $"{me.DisplayName()} soltó el pedido." });
            await db.SaveChangesAsync();
            await tx.CommitAsync();
            return ToDto(o, includePin: false);
        });

        g.MapPost("/orders/{id:int}/pickup", async (int id, ClaimsPrincipal me, DeliveryDbContext db) =>
        {
            var o = await db.Orders.WithDetails().FirstOrDefaultAsync(x => x.Id == id && x.DriverId == me.UserId()) ?? throw AppException.NotFound("Pedido");
            AppException.ThrowIf(o.Status != OrderStatus.Listo, "El pedido todavía no está listo para salir.");
            AddEvent(o, OrderStatus.EnCamino, $"{me.DisplayName()} va en camino.", me.DisplayName());
            await db.SaveChangesAsync();
            return ToDto(o, includePin: false);
        });

        g.MapPost("/orders/{id:int}/deliver", async (int id, DeliverInput input, ClaimsPrincipal me, DeliveryDbContext db) =>
        {
            var o = await db.Orders.WithDetails().FirstOrDefaultAsync(x => x.Id == id && x.DriverId == me.UserId()) ?? throw AppException.NotFound("Pedido");
            AppException.ThrowIf(o.Status != OrderStatus.EnCamino, "Marca primero que vas en camino.");
            AppException.ThrowIf((input.Pin ?? "").Trim() != o.DeliveryPin, "El código de entrega no coincide. Pídeselo al cliente (lo ve en su pedido).");
            AddEvent(o, OrderStatus.Entregado, null, me.DisplayName());
            await db.SaveChangesAsync();
            return ToDto(o, includePin: false);
        }).RequireRateLimiting(HostingSecurity.LoginLimit);

        g.MapPost("/duty", async (DutyInput input, ClaimsPrincipal me, DeliveryDbContext db) =>
        {
            var u = await db.Users.FindAsync(me.UserId());
            u!.OnDuty = input.OnDuty;
            await db.SaveChangesAsync();
            return new { onDuty = u.OnDuty };
        });
    }
}
