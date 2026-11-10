namespace Diversify.Delivery.Core;

/// <summary>Sesión revocable en servidor. Solo se guarda la huella del identificador de la cookie.</summary>
public class UserSession
{
    public string Id { get; set; } = "";
    public int UserId { get; set; }
    public DateTime ExpiresAt { get; set; }
}

// Entidades de Diversify Delivery. Una sola base SQLite (delivery.db) para el supermercado.
// Los precios están en lempiras (L) e incluyen ISV, igual que en Diversify POS.

/// <summary>Estado de la cuenta de un usuario. Los clientes empiezan en PendientePago hasta pagar la inscripción.</summary>
public enum AccountStatus { PendientePago, EnRevision, Activo, Suspendido }

public class User
{
    public int Id { get; set; }
    /// <summary>Con lo que inicia sesión: correo (clientes) o usuario (master y repartidores). Siempre en minúsculas.</summary>
    public string Login { get; set; } = "";
    public string FullName { get; set; } = "";
    public string? Email { get; set; }
    public string? Phone { get; set; }
    public string Role { get; set; } = Roles.Customer;
    public AccountStatus Status { get; set; } = AccountStatus.Activo;
    public string PasswordHash { get; set; } = "";
    /// <summary>Repartidores: placa o descripción del vehículo (moto, carro).</summary>
    public string? Vehicle { get; set; }
    /// <summary>Repartidores: disponible para recibir pedidos.</summary>
    public bool OnDuty { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.Now;
    public DateTime? LastLoginAt { get; set; }
    /// <summary>Clientes: la suscripción mensual está pagada hasta esta fecha. Null = nunca ha pagado.</summary>
    public DateTime? SubscriptionEndsAt { get; set; }
    /// <summary>Clientes: código para invitar a otros (va en el enlace de registro).</summary>
    public string? ReferralCode { get; set; }
    /// <summary>Clientes: quién lo invitó. Esa persona gana puntos con sus compras.</summary>
    public int? ReferredById { get; set; }
}

public enum PointsKind { Compra, Referido, Ajuste }

/// <summary>
/// Movimiento de puntos (1 punto = L 1). El saldo es la suma de los movimientos: nunca se edita un saldo a mano.
/// Compra: el cliente gana un % de su pedido entregado. Referido: quien lo invitó gana un % del mismo pedido.
/// </summary>
public class PointsEntry
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public PointsKind Kind { get; set; }
    public decimal Points { get; set; }
    /// <summary>Pedido que generó los puntos (Compra y Referido).</summary>
    public int? OrderId { get; set; }
    /// <summary>Referido: el cliente invitado que hizo la compra.</summary>
    public int? FromUserId { get; set; }
    public string Description { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.Now;
}

public class Category
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    /// <summary>Emoji o ícono corto que se muestra en la tienda cuando el producto no tiene foto.</summary>
    public string Icon { get; set; } = "🛒";
    public int SortOrder { get; set; }
    public bool Active { get; set; } = true;
    /// <summary>Id de la categoría en Diversify POS (si se sincroniza).</summary>
    public int? DiversifyId { get; set; }
}

public enum ProductSource { Manual, Diversify }

public class Product
{
    public int Id { get; set; }
    public string Code { get; set; } = "";
    public string? Barcode { get; set; }
    public string Name { get; set; } = "";
    public string? Description { get; set; }
    /// <summary>Emoji del producto cuando no tiene foto (si no, se usa el de la categoría).</summary>
    public string? Icon { get; set; }
    public int? CategoryId { get; set; }
    public Category? Category { get; set; }
    public string Unit { get; set; } = "UND";
    /// <summary>Precio de venta en la tienda en línea (con ISV).</summary>
    public decimal Price { get; set; }
    /// <summary>Precio anterior: si es mayor que Price, la tienda lo muestra tachado como oferta.</summary>
    public decimal? CompareAtPrice { get; set; }
    public decimal TaxRate { get; set; }
    /// <summary>Existencia informada por Diversify POS. Null = no se controla.</summary>
    public decimal? Stock { get; set; }
    /// <summary>Visible en la tienda.</summary>
    public bool Active { get; set; } = true;
    /// <summary>Destacado en la portada.</summary>
    public bool Featured { get; set; }
    public string? ImageData { get; set; }
    public ProductSource Source { get; set; } = ProductSource.Manual;
    /// <summary>Id del producto en Diversify POS (si se sincroniza).</summary>
    public int? DiversifyId { get; set; }
    /// <summary>El master cambió el precio a mano: la sincronización ya no lo sobrescribe.</summary>
    public bool PriceLocked { get; set; }
    public DateTime UpdatedAt { get; set; } = DateTime.Now;
}

/// <summary>Bitácora de cambios de precio (quién, cuándo, de cuánto a cuánto).</summary>
public class PriceChange
{
    public int Id { get; set; }
    public int ProductId { get; set; }
    public decimal OldPrice { get; set; }
    public decimal NewPrice { get; set; }
    public string ChangedBy { get; set; } = "";
    public DateTime ChangedAt { get; set; } = DateTime.Now;
}

/// <summary>Dirección de entrega de un cliente. En Honduras pesan más las referencias que la calle.</summary>
public class Address
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public string Label { get; set; } = "Casa";
    public string Line { get; set; } = "";
    /// <summary>Colonia o barrio.</summary>
    public string? Neighborhood { get; set; }
    public string City { get; set; } = "San Pedro Sula";
    /// <summary>Referencias: "portón negro frente a la pulpería".</summary>
    public string? Reference { get; set; }
    public double? Latitude { get; set; }
    public double? Longitude { get; set; }
    public bool IsDefault { get; set; }
}

/// <summary>Recibido → Preparando → Listo → EnCamino → Entregado (o Cancelado).</summary>
public enum OrderStatus { Recibido, Preparando, Listo, EnCamino, Entregado, Cancelado }

public enum PaymentMethod { Efectivo, Transferencia, Tarjeta }

public class Order
{
    public int Id { get; set; }
    /// <summary>Número visible para el cliente: DD-000123.</summary>
    public string Number { get; set; } = "";
    public int CustomerId { get; set; }
    public User? Customer { get; set; }
    public int? DriverId { get; set; }
    public User? Driver { get; set; }
    public OrderStatus Status { get; set; } = OrderStatus.Recibido;

    // Entrega (copia de la dirección al momento del pedido)
    public string DeliveryName { get; set; } = "";
    public string DeliveryPhone { get; set; } = "";
    public string AddressLine { get; set; } = "";
    public string? Neighborhood { get; set; }
    public string City { get; set; } = "";
    public string? Reference { get; set; }
    public double? Latitude { get; set; }
    public double? Longitude { get; set; }
    /// <summary>Instrucciones del cliente para el repartidor y para quien arma el pedido.</summary>
    public string? Instructions { get; set; }
    /// <summary>Permite sustituir un producto agotado por uno parecido.</summary>
    public bool AllowSubstitutions { get; set; } = true;

    // Pago
    public PaymentMethod PaymentMethod { get; set; }
    /// <summary>Efectivo: con cuánto paga el cliente (para llevar cambio).</summary>
    public decimal? CashGiven { get; set; }
    public string? PaymentReference { get; set; }

    public decimal Subtotal { get; set; }
    public decimal DeliveryFee { get; set; }
    public decimal Total { get; set; }

    /// <summary>Código de 4 dígitos que el cliente dicta al recibir: confirma la entrega.</summary>
    public string DeliveryPin { get; set; } = "";
    public string? CancelReason { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.Now;
    public DateTime UpdatedAt { get; set; } = DateTime.Now;
    public DateTime? DeliveredAt { get; set; }

    public List<OrderItem> Items { get; set; } = [];
    public List<OrderEvent> Events { get; set; } = [];
}

public class OrderItem
{
    public int Id { get; set; }
    public int OrderId { get; set; }
    public int ProductId { get; set; }
    public string Code { get; set; } = "";
    public string Name { get; set; } = "";
    public string Unit { get; set; } = "UND";
    /// <summary>Emoji del producto al momento del pedido (para mostrarlo sin consultar el catálogo).</summary>
    public string? Icon { get; set; }
    public decimal Price { get; set; }
    public decimal Quantity { get; set; }
    /// <summary>Lo que realmente se despacha. Null = igual a Quantity; 0 = no disponible.</summary>
    public decimal? FulfilledQuantity { get; set; }
    public string? Note { get; set; }

    public decimal EffectiveQuantity => FulfilledQuantity ?? Quantity;
    public decimal LineTotal => Math.Round(Price * EffectiveQuantity, 2, MidpointRounding.AwayFromZero);
}

/// <summary>Historial de un pedido (cambios de estado, asignación, notas): lo ven el cliente y el master.</summary>
public class OrderEvent
{
    public int Id { get; set; }
    public int OrderId { get; set; }
    public OrderStatus Status { get; set; }
    public string Message { get; set; } = "";
    public string By { get; set; } = "";
    public DateTime At { get; set; } = DateTime.Now;
}

public enum RegistrationPaymentStatus { Pendiente, EnRevision, Aprobado, Rechazado }

/// <summary>Pago de la inscripción del cliente ($5).</summary>
public class RegistrationPayment
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public User? User { get; set; }
    /// <summary>Tarjeta (pasarela en línea) o Transferencia (depósito con referencia).</summary>
    public string Method { get; set; } = "";
    public decimal AmountUsd { get; set; }
    public decimal AmountHnl { get; set; }
    public string? Reference { get; set; }
    /// <summary>Id de la transacción en la pasarela (tarjeta).</summary>
    public string? GatewayId { get; set; }
    /// <summary>Número de orden enviado a la pasarela (PixelPay order_id). Con él se verifica payment_hash.</summary>
    public string? OrderId { get; set; }
    public RegistrationPaymentStatus Status { get; set; } = RegistrationPaymentStatus.Pendiente;
    public string? ReviewedBy { get; set; }
    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.Now;
    public DateTime? ReviewedAt { get; set; }
}

/// <summary>
/// Solicitud de "olvidé mi contraseña". Solo se guarda el SHA-256 del enlace (si alguien copia la base, no puede
/// usar los enlaces). Vence en 1 hora y sirve una sola vez.
/// </summary>
public class PasswordReset
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public string TokenHash { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.Now;
    public DateTime ExpiresAt { get; set; }
    public DateTime? UsedAt { get; set; }
    public string? RequestIp { get; set; }
}

/// <summary>Ajustes de la tienda (una sola fila, Id = 1). Los edita el master.</summary>
public class StoreSettings
{
    public int Id { get; set; } = 1;
    public string StoreName { get; set; } = "Mi supermercado";
    public string? StorePhone { get; set; }
    public string? StoreAddress { get; set; }
    public double? StoreLatitude { get; set; }
    public double? StoreLongitude { get; set; }
    public decimal DeliveryFee { get; set; } = 50;
    /// <summary>Pedido mínimo (sin envío). 0 = sin mínimo.</summary>
    public decimal MinimumOrder { get; set; } = 200;
    /// <summary>Envío gratis desde este subtotal. 0 = nunca.</summary>
    public decimal FreeDeliveryFrom { get; set; } = 1500;
    /// <summary>Suscripción mensual del cliente en dólares (se cobra en lempiras al tipo de cambio).</summary>
    public decimal RegistrationFeeUsd { get; set; } = 5;
    /// <summary>% del total de cada pedido entregado que gana el cliente en puntos (1 punto = L 1).</summary>
    public decimal PointsPercent { get; set; } = 2;
    /// <summary>% del total de cada pedido entregado de un invitado que gana quien lo invitó.</summary>
    public decimal ReferralPercent { get; set; } = 2;
    /// <summary>Lempiras por dólar (para mostrar y cobrar la inscripción en lempiras).</summary>
    public decimal ExchangeRate { get; set; } = 26.50m;
    /// <summary>Datos para pagar por transferencia (banco, cuenta, titular). Texto libre.</summary>
    public string? BankInstructions { get; set; }
    public string OpensAt { get; set; } = "07:00";
    public string ClosesAt { get; set; } = "20:00";
    /// <summary>Recibir pedidos. Apagarlo pausa la tienda (ej. inventario, feriado).</summary>
    public bool AcceptingOrders { get; set; } = true;
    /// <summary>La sincronización con Diversify POS también actualiza precios (los que el master no fijó a mano).</summary>
    public bool SyncPrices { get; set; } = true;
    public DateTime? LastSyncAt { get; set; }
    public string? LastSyncResult { get; set; }
}
