# DKC-015 — DNS for det valgte hosting-miljø.
resource "cloudflare_record" "app" {
  zone_name = var.dns_zone
  name      = var.environment == "prod" ? "@" : var.environment
  type      = "A"
  content   = hcloud_server.k3s.ipv4_address
  proxied   = true
}
