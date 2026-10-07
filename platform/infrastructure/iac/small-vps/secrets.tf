# DKC-015 — secret-injektion via external-secrets. Intet hemmeligt materiale i git.
resource "helm_release" "external_secrets" {
  name             = "external-secrets"
  namespace        = "external-secrets"
  create_namespace = true
  repository       = "https://charts.external-secrets.io"
  chart            = "external-secrets"
  version          = "0.10.4"
}

resource "kubernetes_manifest" "cluster_secret_store" {
  manifest = {
    apiVersion = "external-secrets.io/v1beta1"
    kind       = "ClusterSecretStore"
    metadata = {
      name = "vault-${var.environment}"
    }
    spec = {
      provider = {
        vault = {
          server  = "https://vault.example.org"
          path    = "kv/platform/${var.environment}"
          version = "v2"
          auth = {
            kubernetes = {
              mountPath = "kubernetes"
              role      = "platform-${var.environment}"
            }
          }
        }
      }
    }
  }
  depends_on = [helm_release.external_secrets]
}
