# DKC-015 — variable for den valgte hostingprofil (small-vps).
variable "environment" {
  description = "Miljø-id: dev, staging eller prod."
  type        = string
}

variable "region" {
  description = "Hetzner-region."
  type        = string
}

variable "server_type" {
  description = "Serverstørrelse for k3s-noden."
  type        = string
  default     = "cpx21"
}

variable "admin_cidr" {
  description = "Kilde-CIDR for SSH (aldrig 0.0.0.0/0)."
  type        = string
}

variable "dns_zone" {
  description = "DNS-zone."
  type        = string
}

variable "hostname" {
  description = "Værtsnavn for ingress."
  type        = string
}

variable "storage_size_gb" {
  description = "Størrelse på det krypterede block-storage."
  type        = number
}

variable "encryption_enabled" {
  description = "Kryptering af persistent storage. Skal være true."
  type        = bool
}

variable "k3s_version" {
  description = "Pinnet k3s-version."
  type        = string
}

variable "model_egress_allow" {
  description = "Tilladte model-endpoints for ai-gateway."
  type        = list(string)
}
