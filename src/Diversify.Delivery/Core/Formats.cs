namespace Diversify.Delivery.Core;

public static class Money
{
    public static decimal Round(decimal value) => Math.Round(value, 2, MidpointRounding.AwayFromZero);
}

public static class Text
{
    public static string? Clean(string? value, int max)
    {
        var v = value?.Trim();
        if (string.IsNullOrEmpty(v)) return null;
        return v.Length > max ? v[..max] : v;
    }

    public static string Required(string? value, int max, string field)
    {
        var v = Clean(value, max);
        AppException.ThrowIf(v is null, $"{field} es obligatorio.");
        return v;
    }

    /// <summary>Foto en data URL (PNG/JPEG/WebP) de hasta 400 KB, igual que Diversify POS.</summary>
    public static string? Image(string? data)
    {
        if (string.IsNullOrWhiteSpace(data)) return null;
        AppException.ThrowIf(!(data.StartsWith("data:image/png;base64,") || data.StartsWith("data:image/jpeg;base64,") ||
                               data.StartsWith("data:image/webp;base64,")), "La imagen debe ser PNG, JPEG o WebP.");
        AppException.ThrowIf(data.Length > 560_000, "La imagen pesa más de 400 KB. Usa una más pequeña.");
        return data;
    }
}
