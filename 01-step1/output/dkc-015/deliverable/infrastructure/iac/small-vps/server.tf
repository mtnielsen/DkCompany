# DKC-015 — k3s-server i det private netværk.
resource "hcloud_server" "k3s" {
  name        = "platform-${var.environment}"
  image       = "ubuntu-24.04"
  server_type = var.server_type
  location    = var.region
  labels = {
    environment = var.environment
    managed-by  = "opentofu"
  }

  firewall_ids = [hcloud_firewall.platform.id]
  networks     = [hcloud_network.platform.id]

  user_data = templatefile("${path.module}/cloud-init.yaml", {
    k3s_version = var.k3s_version
    hostname    = var.hostname
  })

  public_net {
    ipv4_enabled = true
    ipv6_enabled = true
  }
}
