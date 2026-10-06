# DKC-015 — namespace og Argo CD, der fører klyngen til GitOps-tilstanden i git.
resource "kubernetes_namespace" "platform" {
  metadata {
    name = var.environment == "prod" ? "platform-prod" : "platform-${var.environment}"
    labels = {
      "platform.example.org/environment" = var.environment
    }
  }
}

resource "helm_release" "argocd" {
  name             = "argocd"
  namespace        = "argocd"
  create_namespace = true
  repository       = "https://argoproj.github.io/argo-helm"
  chart            = "argo-cd"
  version          = "7.6.12"

  values = [yamlencode({
    configs = {
      params = {
        "server.insecure" = true
      }
    }
  })]
}
