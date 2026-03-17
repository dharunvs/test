terraform {
  required_version = ">= 1.7.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  type        = string
  description = "AWS region for Branchline infrastructure"
  default     = "us-east-1"
}

output "note" {
  value = "Expand this module with RDS, ElastiCache, S3, and ECS/EKS resources for production."
}
