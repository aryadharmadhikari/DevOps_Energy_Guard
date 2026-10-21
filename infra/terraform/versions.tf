terraform {
  required_version = ">= 1.9"
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 6.60" }
    tls    = { source = "hashicorp/tls", version = "~> 4.4" }
    random = { source = "hashicorp/random", version = "~> 3.9" }
    local  = { source = "hashicorp/local", version = "~> 2.5" }
  }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = { Project = "energyguard" }
  }
}
