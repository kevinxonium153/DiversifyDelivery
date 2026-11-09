using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Diversify.Delivery.Core;

namespace Diversify.Delivery.Modules;

// PixelPay (pasarela de pago de Honduras) para la inscripción de US$5, con **Hosted Payment** (checkout de PixelPay).
// Es la integración que PixelPay recomienda cuando el comercio no quiere manejar datos de tarjeta (docs PixelPay:
// integrations/hosted-payment). Ver docs/PIXELPAY.md y notas/Decisiones/005.
//
//  1. Este servidor manda la orden a PixelPay (api/v2/transaction/hosted/other) firmada con x-client-signature:
//     HMAC SHA3-512 de "key|order_id|endpoint" con la llave secreta. PixelPay responde la URL de su checkout.
//  2. El cliente paga en la página de PixelPay (tarjeta y 3-D Secure). Esta app nunca ve la tarjeta.
//  3. PixelPay devuelve al cliente a _complete?paymentHash=… y, aparte, avisa a _callback (servidor a servidor).
//     En ambos se comprueba payment_hash = MD5(order_id|key|llave secreta): solo PixelPay y nosotros conocemos la
//     llave secreta, así que nadie más puede fabricarlo. El monto lo fija este servidor, no el navegador.
//
// Configuración (/etc/diversify-delivery/delivery.env):
//   PixelPay__Endpoint=https://...      dominio del comercio en PixelPay (Preferencias > Opciones del API)
//   PixelPay__Key=...                   Key ID del comercio
//   PixelPay__SecretKey=...             llave secreta: nunca sale del servidor
//   PixelPay__Currency=HNL              HNL o USD, según lo que tenga habilitado el comercio
//   PixelPay__Sandbox=true              solo pruebas: ruta hosted/sandbox con las credenciales públicas de prueba

/// <summary>Datos de la orden para el checkout de PixelPay.</summary>
public record HostedOrder(string OrderId, decimal Amount, string Description, string FullName, string Email, string? Phone,
    string CompleteUrl, string CancelUrl, string? CallbackUrl);

public class PixelPayService(IConfiguration config, IHttpClientFactory httpFactory, ILogger<PixelPayService> log)
{
    // Credenciales públicas del sandbox de PixelPay (docs: sandbox/hosted-payment).
    private const string SandboxKey = "1234567890";
    private const string SandboxSecret = "@s4ndb0x-abcd-1234-n1l4-p1x3l";

    public bool Sandbox => config.GetValue("PixelPay:Sandbox", false);
    public string Endpoint => (string.IsNullOrWhiteSpace(config["PixelPay:Endpoint"]) ? "https://pixelpay.app" : config["PixelPay:Endpoint"]!).TrimEnd('/');
    public string Key => Sandbox ? SandboxKey : config["PixelPay:Key"] ?? "";
    private string Secret => Sandbox ? SandboxSecret : config["PixelPay:SecretKey"] ?? "";
    public string Currency => (config["PixelPay:Currency"] ?? "HNL").ToUpperInvariant() == "USD" ? "USD" : "HNL";
    public bool Configured => !string.IsNullOrWhiteSpace(Key) && !string.IsNullOrWhiteSpace(Secret);
    private string HostedUrl => $"{Endpoint}/api/v2/transaction/hosted/{(Sandbox ? "sandbox" : "other")}";

    private static string Md5(string value) => Convert.ToHexStringLower(MD5.HashData(Encoding.UTF8.GetBytes(value)));

    /// <summary>
    /// Firma de seguridad de PixelPay (x-client-signature / _client_signature): HMAC SHA3-512 de
    /// "key|order_id|app_url" con la llave secreta. app_url es el endpoint del comercio.
    /// </summary>
    public string Signature(string orderId) =>
        Convert.ToHexStringLower(HMACSHA3_512.HashData(Encoding.UTF8.GetBytes(Secret), Encoding.UTF8.GetBytes($"{Key}|{orderId}|{Endpoint}")));

    /// <summary>Comprueba payment_hash = MD5(order_id|key|secret), como verifyPaymentHash del SDK.</summary>
    public bool VerifyHash(string orderId, string? paymentHash)
    {
        if (string.IsNullOrWhiteSpace(paymentHash)) return false;
        var expected = Encoding.ASCII.GetBytes(Md5($"{orderId}|{Key}|{Secret}"));
        var given = Encoding.ASCII.GetBytes(paymentHash.Trim().ToLowerInvariant());
        return CryptographicOperations.FixedTimeEquals(expected, given);
    }

    /// <summary>Crea el cobro en PixelPay y devuelve la URL de su checkout.</summary>
    public async Task<string> CreateCheckoutAsync(HostedOrder order, CancellationToken ct = default)
    {
        var (first, last) = SplitName(order.FullName);
        var amount = order.Amount.ToString("0.00", CultureInfo.InvariantCulture);
        var item = new[] { new { code = "INSCRIPCION", title = order.Description, price = order.Amount, qty = 1, tax = 0m, total = order.Amount } };
        var fields = new Dictionary<string, string>
        {
            ["_key"] = Key,
            ["_client_signature"] = Signature(order.OrderId),
            ["_order_id"] = order.OrderId,
            ["_order_date"] = DateTime.Now.ToString("dd-MM-yy HH:mm", CultureInfo.InvariantCulture),
            ["_order_content"] = Convert.ToBase64String(JsonSerializer.SerializeToUtf8Bytes(item)),
            ["_currency"] = Currency,
            ["_amount"] = amount,
            ["_tax_amount"] = "0.00",
            ["_shipping_amount"] = "0.00",
            ["_first_name"] = first,
            ["_last_name"] = last,
            ["_email"] = order.Email,
            ["_country"] = "Honduras",
            ["_complete"] = order.CompleteUrl,
            ["_cancel"] = order.CancelUrl,
            ["json"] = "true",
        };
        if (!string.IsNullOrWhiteSpace(order.CallbackUrl)) fields["_callback"] = order.CallbackUrl;

        string body;
        int status;
        try
        {
            using var http = httpFactory.CreateClient();
            http.Timeout = TimeSpan.FromSeconds(30);
            using var req = new HttpRequestMessage(HttpMethod.Post, HostedUrl) { Content = new FormUrlEncodedContent(fields) };
            req.Headers.Add("Accept", "application/json");
            req.Headers.Add("x-client-signature", fields["_client_signature"]);
            using var res = await http.SendAsync(req, ct);
            status = (int)res.StatusCode;
            body = await res.Content.ReadAsStringAsync(ct);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            log.LogWarning(ex, "No se pudo conectar con PixelPay para la orden {Order}", order.OrderId);
            throw new AppException("No pudimos conectar con PixelPay. Intenta de nuevo en un momento o paga por transferencia.");
        }

        try
        {
            using var doc = JsonDocument.Parse(body);
            var root = doc.RootElement;
            if (root.TryGetProperty("success", out var ok) && ok.ValueKind == JsonValueKind.True
                && root.TryGetProperty("url", out var u) && Uri.TryCreate(u.GetString(), UriKind.Absolute, out var url)
                && (url.Scheme == Uri.UriSchemeHttps || (url.Scheme == Uri.UriSchemeHttp && url.IsLoopback)))
                return url.ToString();
            var detail = FirstError(root);
            log.LogWarning("PixelPay rechazó la orden {Order} ({Status}): {Body}", order.OrderId, status, Truncate(body, 500));
            throw new AppException(detail is null ? "PixelPay no aceptó el cobro. Intenta de nuevo o paga por transferencia."
                : $"PixelPay no aceptó el cobro: {detail}");
        }
        catch (JsonException)
        {
            log.LogWarning("PixelPay respondió {Status} sin JSON para la orden {Order}: {Body}", status, order.OrderId, Truncate(body, 300));
            throw new AppException("PixelPay no respondió como se esperaba. Intenta de nuevo o paga por transferencia.");
        }
    }

    /// <summary>Nombre y apellido como los pide PixelPay (nombre ≥ 3 letras, apellido ≥ 2).</summary>
    public static (string First, string Last) SplitName(string fullName)
    {
        var parts = (fullName ?? "").Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var first = parts.Length > 0 ? parts[0] : "";
        var last = parts.Length > 1 ? string.Join(' ', parts[1..]) : "";
        if (first.Length < 3) first = (fullName ?? "").Trim().Length >= 3 ? fullName!.Trim() : "Cliente";
        if (last.Length < 2) last = "Cliente";
        return (Truncate(first, 120), Truncate(last, 120));
    }

    private static string? FirstError(JsonElement root)
    {
        if (root.TryGetProperty("errors", out var errors) && errors.ValueKind == JsonValueKind.Object)
            foreach (var field in errors.EnumerateObject())
                if (field.Value.ValueKind == JsonValueKind.Array && field.Value.GetArrayLength() > 0)
                    return field.Value[0].GetString();
        return root.TryGetProperty("message", out var m) && m.ValueKind == JsonValueKind.String ? m.GetString() : null;
    }

    private static string Truncate(string s, int max) => s.Length > max ? s[..max] : s;

    public static decimal? ReadDecimal(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v)) return null;
        if (v.ValueKind == JsonValueKind.Number && v.TryGetDecimal(out var n)) return n;
        if (v.ValueKind == JsonValueKind.String && decimal.TryParse(v.GetString(), NumberStyles.Number, CultureInfo.InvariantCulture, out var s)) return s;
        return null;
    }

    public static string? ReadString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) ? v.ValueKind switch
        {
            JsonValueKind.String => v.GetString(),
            JsonValueKind.Number => v.GetRawText(),
            _ => null,
        } : null;
}
