# DKC-015 — krypteret persistent storage.
resource "hcloud_volume" "data" {
  name     = "platform-data-${var.environment}"
  size     = var.storage_size_gb
  location = var.region
  labels = {
    environment = var.environment
    encrypted   = tostring(var.encryption_enabled)
  }
}

resource "hcloud_volume_attachment" "data" {
  volume_id = hcloud_volume.data.id
  server_id = hcloud_server.k3s.id
  automount = true
}
