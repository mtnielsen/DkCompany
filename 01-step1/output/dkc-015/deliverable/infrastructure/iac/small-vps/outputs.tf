# DKC-015 — outputs. Kubeconfig er sensitiv og må ikke optræde i logs.
output "kubeconfig" {
  value     = hcloud_server.k3s.id
  sensitive = true
}

output "ingress_ipv4" {
  value = hcloud_server.k3s.ipv4_address
}

output "hostname" {
  value = var.hostname
}

output "encryption_enabled" {
  value = var.encryption_enabled
}
