# DKC-015 — privat netværk og default-deny firewall.
resource "hcloud_network" "platform" {
  name     = "platform-${var.environment}"
  ip_range = "10.0.0.0/16"
}

resource "hcloud_network_subnet" "nodes" {
  network_id   = hcloud_network.platform.id
  type         = "cloud"
  network_zone = "eu-central"
  ip_range     = "10.0.1.0/24"
}

resource "hcloud_firewall" "platform" {
  name = "platform-${var.environment}"

  # Standard er at afvise alt; kun de nedenstående regler lukkes op.
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "443"
    source_ips = ["0.0.0.0/0", "::/0"]
    description = "Offentlig HTTPS til ingress"
  }
  rule {
    direction  = "in"
    protocol   = "tcp"
    port       = "22"
    source_ips = [var.admin_cidr]
    description = "SSH kun fra administrator-CIDR"
  }
  rule {
    direction       = "out"
    protocol        = "tcp"
    port            = "1-65535"
    destination_ips = ["0.0.0.0/0"]
    description     = "Udgående trafik til model- og backupmål"
  }
}
