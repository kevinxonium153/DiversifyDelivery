using Microsoft.EntityFrameworkCore;

namespace Diversify.Delivery.Core;

public class DeliveryDbContext(DbContextOptions<DeliveryDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<Category> Categories => Set<Category>();
    public DbSet<Product> Products => Set<Product>();
    public DbSet<PriceChange> PriceChanges => Set<PriceChange>();
    public DbSet<Address> Addresses => Set<Address>();
    public DbSet<Order> Orders => Set<Order>();
    public DbSet<OrderItem> OrderItems => Set<OrderItem>();
    public DbSet<OrderEvent> OrderEvents => Set<OrderEvent>();
    public DbSet<RegistrationPayment> RegistrationPayments => Set<RegistrationPayment>();
    public DbSet<StoreSettings> Settings => Set<StoreSettings>();
    public DbSet<PasswordReset> PasswordResets => Set<PasswordReset>();

    protected override void OnModelCreating(ModelBuilder model)
    {
        model.Entity<User>(e =>
        {
            e.HasIndex(x => x.Login).IsUnique();
            e.Property(x => x.Login).HasMaxLength(120);
            e.Property(x => x.FullName).HasMaxLength(120);
            e.Property(x => x.Email).HasMaxLength(120);
            e.Property(x => x.Phone).HasMaxLength(30);
            e.Property(x => x.Role).HasMaxLength(20);
            e.Property(x => x.Vehicle).HasMaxLength(60);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
        });
        model.Entity<Category>(e =>
        {
            e.Property(x => x.Name).HasMaxLength(80);
            e.Property(x => x.Icon).HasMaxLength(16);
            e.HasIndex(x => x.DiversifyId);
        });
        model.Entity<Product>(e =>
        {
            e.HasIndex(x => x.Code);
            e.HasIndex(x => x.DiversifyId);
            e.Property(x => x.Code).HasMaxLength(40);
            e.Property(x => x.Barcode).HasMaxLength(40);
            e.Property(x => x.Name).HasMaxLength(160);
            e.Property(x => x.Description).HasMaxLength(600);
            e.Property(x => x.Icon).HasMaxLength(16);
            e.Property(x => x.Unit).HasMaxLength(12);
            e.Property(x => x.Source).HasConversion<string>().HasMaxLength(12);
            e.HasOne(x => x.Category).WithMany().HasForeignKey(x => x.CategoryId).OnDelete(DeleteBehavior.SetNull);
        });
        model.Entity<Address>(e =>
        {
            e.HasIndex(x => x.UserId);
            e.Property(x => x.Label).HasMaxLength(40);
            e.Property(x => x.Line).HasMaxLength(200);
            e.Property(x => x.Neighborhood).HasMaxLength(100);
            e.Property(x => x.City).HasMaxLength(60);
            e.Property(x => x.Reference).HasMaxLength(300);
        });
        model.Entity<Order>(e =>
        {
            e.HasIndex(x => x.Number).IsUnique();
            e.HasIndex(x => x.Status);
            e.HasIndex(x => x.CustomerId);
            e.HasIndex(x => x.DriverId);
            e.Property(x => x.Number).HasMaxLength(20);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(16);
            e.Property(x => x.PaymentMethod).HasConversion<string>().HasMaxLength(16);
            e.Property(x => x.DeliveryName).HasMaxLength(120);
            e.Property(x => x.DeliveryPhone).HasMaxLength(30);
            e.Property(x => x.AddressLine).HasMaxLength(200);
            e.Property(x => x.Neighborhood).HasMaxLength(100);
            e.Property(x => x.City).HasMaxLength(60);
            e.Property(x => x.Reference).HasMaxLength(300);
            e.Property(x => x.Instructions).HasMaxLength(500);
            e.Property(x => x.PaymentReference).HasMaxLength(80);
            e.Property(x => x.DeliveryPin).HasMaxLength(6);
            e.Property(x => x.CancelReason).HasMaxLength(300);
            e.HasOne(x => x.Customer).WithMany().HasForeignKey(x => x.CustomerId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x => x.Driver).WithMany().HasForeignKey(x => x.DriverId).OnDelete(DeleteBehavior.SetNull);
            e.HasMany(x => x.Items).WithOne().HasForeignKey(x => x.OrderId).OnDelete(DeleteBehavior.Cascade);
            e.HasMany(x => x.Events).WithOne().HasForeignKey(x => x.OrderId).OnDelete(DeleteBehavior.Cascade);
        });
        model.Entity<OrderItem>(e =>
        {
            e.Property(x => x.Code).HasMaxLength(40);
            e.Property(x => x.Name).HasMaxLength(160);
            e.Property(x => x.Unit).HasMaxLength(12);
            e.Property(x => x.Note).HasMaxLength(200);
            e.Property(x => x.Icon).HasMaxLength(16);
            e.Ignore(x => x.EffectiveQuantity);
            e.Ignore(x => x.LineTotal);
        });
        model.Entity<OrderEvent>(e =>
        {
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(16);
            e.Property(x => x.Message).HasMaxLength(300);
            e.Property(x => x.By).HasMaxLength(120);
        });
        model.Entity<RegistrationPayment>(e =>
        {
            e.HasIndex(x => x.UserId);
            e.Property(x => x.Method).HasMaxLength(20);
            e.Property(x => x.Reference).HasMaxLength(80);
            e.Property(x => x.GatewayId).HasMaxLength(80);
            e.Property(x => x.OrderId).HasMaxLength(60);
            e.HasIndex(x => x.GatewayId);
            e.Property(x => x.ReviewedBy).HasMaxLength(120);
            e.Property(x => x.Notes).HasMaxLength(300);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(16);
            e.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });
        model.Entity<PasswordReset>(e =>
        {
            e.HasIndex(x => x.TokenHash).IsUnique();
            e.HasIndex(x => x.UserId);
            e.Property(x => x.TokenHash).HasMaxLength(64);
            e.Property(x => x.RequestIp).HasMaxLength(64);
        });
        model.Entity<StoreSettings>(e =>
        {
            e.Property(x => x.StoreName).HasMaxLength(120);
            e.Property(x => x.StorePhone).HasMaxLength(30);
            e.Property(x => x.StoreAddress).HasMaxLength(200);
            e.Property(x => x.BankInstructions).HasMaxLength(500);
            e.Property(x => x.OpensAt).HasMaxLength(5);
            e.Property(x => x.ClosesAt).HasMaxLength(5);
            e.Property(x => x.LastSyncResult).HasMaxLength(500);
        });

        // SQLite no ordena ni compara decimal de forma nativa: se guardan como double (2 decimales bastan).
        foreach (var prop in model.Model.GetEntityTypes().SelectMany(t => t.GetProperties())
                     .Where(p => p.ClrType == typeof(decimal) || p.ClrType == typeof(decimal?)))
            prop.SetValueConverter(prop.ClrType == typeof(decimal)
                ? new Microsoft.EntityFrameworkCore.Storage.ValueConversion.ValueConverter<decimal, double>(v => (double)v, v => (decimal)v)
                : new Microsoft.EntityFrameworkCore.Storage.ValueConversion.ValueConverter<decimal?, double?>(v => (double?)v, v => (decimal?)v));
    }
}
