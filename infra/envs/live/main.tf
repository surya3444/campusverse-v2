# The live (production) environment: its own AWS account, real schools. Claude Code has no
# credentials here; the owner plans and applies every change:
#   terraform -chdir=infra/envs/live init -backend-config="bucket=<state bucket from bootstrap>"
#   terraform -chdir=infra/envs/live plan -var-file=live.tfvars   # review, then apply yourself

terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
  backend "s3" {
    key          = "campusverse/live.tfstate"
    region       = "ap-south-1"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = "ap-south-1"
  default_tags { tags = { project = "campusverse", environment = "production" } }
}

# Backup copies stay in India: Hyderabad.
provider "aws" {
  alias  = "copy"
  region = "ap-south-2"
  default_tags { tags = { project = "campusverse", environment = "production" } }
}

variable "zone_id" { type = string }
variable "domain" { type = string }
variable "alert_email" { type = string }
variable "admin_cidrs" {
  description = "Office or VPN networks allowed to open the admin portal."
  type        = list(string)
  default     = []
}
variable "optional_secrets" {
  type    = set(string)
  default = []
}
variable "simulate_providers" {
  description = "on shows OTP codes on screen to whoever asks: anyone who knows a phone number can sign in as that person. Only before real schools, and off as soon as an SMS provider is connected."
  type        = string
  default     = "off"
}

module "env" {
  source             = "../../modules/environment"
  providers          = { aws = aws, aws.copy = aws.copy }
  name               = "campusverse-live"
  app_env            = "production"
  cidr               = "10.30.0.0/16"
  zone_id            = var.zone_id
  hosts              = { app = "app.${var.domain}", admin = "admin.${var.domain}", api = "api.${var.domain}" }
  admin_cidrs        = var.admin_cidrs
  alert_email        = var.alert_email
  optional_secrets   = var.optional_secrets
  simulate_providers = var.simulate_providers
  # ponytail: starting size for a pilot of a few schools; raise after the load tests (Milestone 17).
  monthly_budget_usd = 600
  size = {
    nat_per_zone        = true
    db_instance_class   = "db.m7g.large"
    db_storage_gb       = 100
    multi_az            = true
    db_backup_days      = 35
    cache_node_type     = "cache.m7g.large"
    cache_nodes         = 2
    deletion_protection = true
    backup_keep_days    = 35
    copy_backups        = true
    desired             = { api = 2, worker = 2, web = 2, admin = 1 }
  }
}

output "cluster" { value = module.env.cluster }
output "ecr" { value = module.env.ecr }
output "secrets" { value = module.env.secrets }
output "db_endpoint" { value = module.env.db_endpoint }
output "db_master_secret_arn" { value = module.env.db_master_secret_arn }
