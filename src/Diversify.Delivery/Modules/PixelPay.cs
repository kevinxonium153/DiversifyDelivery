using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Diversify.Delivery.Modules;

// PixelPay (pasarela de pago de Honduras) para la inscripción de US$5.
//
// Cómo funciona (igual que el SDK oficial @pixelpay/sdk-core):
//  1. El navegador del cliente usa el SDK de PixelPay (js/vendor/pixelpay-sdk.js, alojado aquí mismo). El SDK cifra
//     los datos de la tarjeta con la llave pública del comercio y los manda DIRECTO a PixelPay. Este servidor nunca
//     recibe el número, el vencimiento ni el CVV. Si el banco pide 3-D Secure, el SDK lo resuelve en el navegador.
//  2. PixelPay responde al navegador con payment_uuid y payment_hash, y el navegador nos los manda.
//  3. Aquí se comprueba: payment_hash = MD5(order_id|llave|llave secreta) (solo PixelPay y nosotros conocemos la
//     secreta) y se consulta el estado de la transacción en PixelPay (api/v2/transaction/status). Solo si PixelPay
//     dice que está aprobada se activa la cuenta. Si no se puede consultar, el pago queda "En revisión" para que el
//     master lo confirme en el portal de PixelPay.
//
// Configuración (/etc/diversify-delivery/delivery.env):
//   PixelPay__Endpoint=https://...      (la URL que PixelPay asigna al comercio; por defecto https://pixelpay.app)
//   PixelPay__Key=...                   (Key ID del comercio)
//   PixelPay__SecretKey=...             (llave secreta: nunca sale del servidor)
//   PixelPay__Currency=HNL              (HNL o USD, según lo que tenga habilitado el comercio)
//   PixelPay__Sandbox=true              (solo pruebas: usa pixelpay.dev con las credenciales públicas de prueba)

public enum PixelPayVerdict { Aprobado, Rechazado, SinConfirmar }

public record PixelPayStatus(PixelPayVerdict Verdict, string Message);

public class PixelPayService(IConfiguration config, IHttpClientFactory httpFactory, ILogger<PixelPayService> log)
{
    // Credenciales públicas del sandbox, tomadas del SDK oficial (Settings.setupSandbox).
    private const string SandboxEndpoint = "https://pixelpay.dev";
    private const string SandboxKey = "1234567890";
    private const string SandboxSecret = "@s4ndb0x-abcd-1234-n1l4-p1x3l";

    public bool Sandbox => config.GetValue("PixelPay:Sandbox", false);
    public string Endpoint => (Sandbox ? SandboxEndpoint : config["PixelPay:Endpoint"] ?? "https://pixelpay.app").TrimEnd('/');
    public string Key => Sandbox ? SandboxKey : config["PixelPay:Key"] ?? "";
    private string Secret => Sandbox ? SandboxSecret : config["PixelPay:SecretKey"] ?? "";
    public string Currency => (config["PixelPay:Currency"] ?? "HNL").ToUpperInvariant() == "USD" ? "USD" : "HNL";
    public bool Configured => !string.IsNullOrWhiteSpace(Key) && !string.IsNullOrWhiteSpace(Secret);

    /// <summary>x-auth-hash que pide PixelPay: MD5 de la llave secreta (el SDK lo usa en el navegador).</summary>
    public string AuthHash => Md5(Secret);

    /// <summary>Origen de PixelPay para la CSP de la página de pago (ej. https://pixelpay.app).</summary>
    public string Origin => new Uri(Endpoint).GetLeftPart(UriPartial.Authority);

    private static string Md5(string value) => Convert.ToHexStringLower(MD5.HashData(Encoding.UTF8.GetBytes(value)));

    /// <summary>Comprueba payment_hash = MD5(order_id|key|secret), como Transaction.verifyPaymentHash del SDK.</summary>
    public bool VerifyHash(string orderId, string? paymentHash)
    {
        if (string.IsNullOrWhiteSpace(paymentHash)) return false;
        var expected = Encoding.ASCII.GetBytes(Md5($"{orderId}|{Key}|{Secret}"));
        var given = Encoding.ASCII.GetBytes(paymentHash.Trim().ToLowerInvariant());
        return CryptographicOperations.FixedTimeEquals(expected, given);
    }

    /// <summary>Consulta en PixelPay el estado de una transacción (api/v2/transaction/status).</summary>
    public async Task<PixelPayStatus> GetStatusAsync(string paymentUuid, decimal expectedAmount, CancellationToken ct = default)
    {
        try
        {
            using var http = httpFactory.CreateClient();
            http.Timeout = TimeSpan.FromSeconds(30);
            using var req = new HttpRequestMessage(HttpMethod.Post, $"{Endpoint}/api/v2/transaction/status")
            {
                Content = JsonContent.Create(new { payment_uuid = paymentUuid, env = Sandbox ? "sandbox" : null, lang = "es", from = "diversify-delivery" }),
            };
            req.Headers.Add("Accept", "application/json");
            req.Headers.Add("x-auth-key", Key);
            req.Headers.Add("x-auth-hash", AuthHash);
            using var res = await http.SendAsync(req, ct);
            var body = await res.Content.ReadAsStringAsync(ct);
            if (!(res.Content.Headers.ContentType?.MediaType?.Contains("json") ?? false))
                return new(PixelPayVerdict.SinConfirmar, $"PixelPay respondió {(int)res.StatusCode} sin datos.");

            using var doc = JsonDocument.Parse(body);
            var root = doc.RootElement;
            var data = root.TryGetProperty("data", out var d) && d.ValueKind == JsonValueKind.Object ? d : default;
            var message = root.TryGetProperty("message", out var m) && m.ValueKind == JsonValueKind.String ? m.GetString() ?? "" : "";
            if (data.ValueKind != JsonValueKind.Object)
                return new(PixelPayVerdict.SinConfirmar, $"PixelPay respondió {(int)res.StatusCode}: {message}");

            if (data.TryGetProperty("payment_uuid", out var u) && u.ValueKind == JsonValueKind.String && u.GetString() != paymentUuid)
                return new(PixelPayVerdict.Rechazado, "La transacción no corresponde a este pago.");

            // response_approved es el campo de TransactionResult del SDK. Si no viene, no se adivina: queda en revisión.
            if (!data.TryGetProperty("response_approved", out var approved) || approved.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
                return new(PixelPayVerdict.SinConfirmar, "PixelPay no indicó si la transacción fue aprobada.");
            if (approved.ValueKind == JsonValueKind.False)
            {
                var reason = data.TryGetProperty("response_reason", out var r) && r.ValueKind == JsonValueKind.String ? r.GetString() : message;
                return new(PixelPayVerdict.Rechazado, string.IsNullOrWhiteSpace(reason) ? "El banco rechazó el pago." : reason!);
            }
            var amount = ReadDecimal(data, "transaction_approved_amount") ?? ReadDecimal(data, "transaction_amount");
            if (amount is not null && Math.Abs(amount.Value - expectedAmount) > 0.01m)
                return new(PixelPayVerdict.SinConfirmar, $"Monto aprobado ({amount:N2}) distinto al de la inscripción ({expectedAmount:N2}).");
            return new(PixelPayVerdict.Aprobado, "Aprobado por PixelPay.");
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException or UriFormatException)
        {
            log.LogWarning(ex, "No se pudo consultar el estado del pago {Uuid} en PixelPay", paymentUuid);
            return new(PixelPayVerdict.SinConfirmar, "No se pudo consultar PixelPay en este momento.");
        }
    }

    private static decimal? ReadDecimal(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v)) return null;
        if (v.ValueKind == JsonValueKind.Number && v.TryGetDecimal(out var n)) return n;
        if (v.ValueKind == JsonValueKind.String && decimal.TryParse(v.GetString(), System.Globalization.NumberStyles.Number,
                System.Globalization.CultureInfo.InvariantCulture, out var s)) return s;
        return null;
    }
}
