using System.Net;
using System.Net.Mail;

namespace Diversify.Delivery.Core;

// Envío de correos (recuperar contraseña y, más adelante, avisos de pedidos).
//
// Configuración (/etc/diversify-delivery/delivery.env), sirve cualquier SMTP (Gmail, Brevo, el del dominio):
//   Email__Host=smtp-relay.brevo.com
//   Email__Port=587
//   Email__User=usuario
//   Email__Password=contraseña-o-llave-smtp
//   Email__From="Súper La Esperanza <no-responder@delivery.diversify.hn>"
//   Email__EnableSsl=true
//
// Sin Email:Host (desarrollo y pruebas), los correos se guardan como archivos .eml en Email:PickupFolder
// (por defecto data/correos) en lugar de enviarse.

public record EmailMessage(string To, string Subject, string Html, string Text);

public interface IEmailSender
{
    /// <summary>true si hay servidor SMTP configurado (si no, los correos van a la carpeta de pruebas).</summary>
    bool Configured { get; }
    Task SendAsync(EmailMessage message, CancellationToken ct = default);
}

public class SmtpEmailSender(IConfiguration config, IHostEnvironment env, ILogger<SmtpEmailSender> log) : IEmailSender
{
    public bool Configured => !string.IsNullOrWhiteSpace(config["Email:Host"]);

    public async Task SendAsync(EmailMessage message, CancellationToken ct = default)
    {
        var from = MailAddress.TryCreate(config["Email:From"], out var f) ? f : new MailAddress("no-responder@localhost", "Diversify Delivery");
        using var mail = new MailMessage { From = from, Subject = message.Subject, SubjectEncoding = System.Text.Encoding.UTF8,
            BodyEncoding = System.Text.Encoding.UTF8, IsBodyHtml = false, Body = message.Text };
        mail.To.Add(message.To);
        mail.AlternateViews.Add(AlternateView.CreateAlternateViewFromString(message.Html, System.Text.Encoding.UTF8, "text/html"));

        using var smtp = new SmtpClient();
        if (Configured)
        {
            smtp.Host = config["Email:Host"]!;
            smtp.Port = config.GetValue("Email:Port", 587);
            smtp.EnableSsl = config.GetValue("Email:EnableSsl", true);
            if (!string.IsNullOrWhiteSpace(config["Email:User"]))
                smtp.Credentials = new NetworkCredential(config["Email:User"], config["Email:Password"]);
        }
        else
        {
            var folder = DataPaths.Resolve(config, env, config["Email:PickupFolder"] ?? "data/correos");
            Directory.CreateDirectory(folder);
            smtp.DeliveryMethod = SmtpDeliveryMethod.SpecifiedPickupDirectory;
            smtp.PickupDirectoryLocation = folder;
            log.LogInformation("Correo a {To} guardado en {Folder} (sin servidor SMTP configurado)", message.To, folder);
        }
        await smtp.SendMailAsync(mail, ct);
    }
}
