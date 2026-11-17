# The test environment: its own AWS account, synthetic data only, deployed automatically after
# every merge to main. Same design as live, smaller and cheaper.
#   terraform -chdir=infra/envs/test init -backend-config="bucket=<state bucket from bootstrap>"
#   terraform -chdir=infra/envs/test apply -var-file=test.tfvars

terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
  backend "s3" {
    key          = "campusverse/test.tfstate"
    region       = "ap-south-1"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = "ap-south-1"
  default_tags { tags = { project = "campusverse", environment = "test" } }
}

provider "aws" {
  alias  = "copy"
  region = "ap-south-2"
  default_tags { tags = { project = "campusverse", environment = "test" } }
}

variable "zone_id" { type = string }
variable "domain" { type = string }
variable "alert_email" { type = string }
variable "message_allowlist" {
  type    = string
  default = ""
}

module "env" {
  source            = "../../modules/environment"
  providers         = { aws = aws, aws.copy = aws.copy }
  name              = "campusverse-test"
  app_env           = "test"
  cidr              = "10.20.0.0/16"
  zone_id           = var.zone_id
  hosts             = { app = "test.${var.domain}", admin = "admin.test.${var.domain}", api = "api.test.${var.domain}" }
  alert_email       = var.alert_email
  message_allowlist = var.message_allowlist
  # Testers see OTP codes and messages on screen until providers are connected.
  simulate_providers = "on"
  # Razorpay test-mode keys can be wired here once their secret values exist.
  optional_secrets   = []
  monthly_budget_usd = 150
  size = {
    nat_per_zone        = false
    db_instance_class   = "db.t4g.medium"
    db_storage_gb       = 50
    multi_az            = false
    db_backup_days      = 3
    cache_node_type     = "cache.t4g.small"
    cache_nodes         = 1
    deletion_protection = false
    backup_keep_days    = 7
    copy_backups        = false
    desired             = { api = 1, worker = 1, web = 1, admin = 1 }
  }
}

output "cluster" { value = module.env.cluster }
output "ecr" { value = module.env.ecr }
output "secrets" { value = module.env.secrets }
output "db_endpoint" { value = module.env.db_endpoint }
output "db_master_secret_arn" { value = module.env.db_master_secret_arn }
output "db_instance_id" { value = module.env.db_instance_id }
output "db_subnet_group" { value = module.env.db_subnet_group }
output "private_subnet_ids" { value = module.env.private_subnet_ids }
output "sg" { value = module.env.sg }
