# One whole environment. Test and live call this same module with different sizes, so test
# rehearses live's design (guide: shared modules for both accounts).

terraform {
  required_providers {
    aws = {
      source                = "hashicorp/aws"
      configuration_aliases = [aws.copy]
    }
  }
}

variable "name" { type = string }
variable "app_env" { type = string }
variable "cidr" { type = string }
variable "zone_id" { type = string }
variable "hosts" { type = object({ app = string, admin = string, api = string }) }
variable "admin_cidrs" {
  type    = list(string)
  default = []
}
variable "alert_email" { type = string }
variable "monthly_budget_usd" { type = number }
variable "message_allowlist" {
  type    = string
  default = ""
}
variable "simulate_providers" {
  type    = string
  default = "off"
}
variable "optional_secrets" {
  type    = set(string)
  default = []
}
variable "size" {
  description = "Everything that differs in size or safety between test and live."
  type = object({
    nat_per_zone        = bool
    db_instance_class   = string
    db_storage_gb       = number
    multi_az            = bool
    db_backup_days      = number
    cache_node_type     = string
    cache_nodes         = number
    deletion_protection = bool
    backup_keep_days    = number
    copy_backups        = bool
    desired             = object({ api = number, worker = number, web = number, admin = number })
  })
}

module "network" {
  source       = "../network"
  name         = var.name
  cidr         = var.cidr
  nat_per_zone = var.size.nat_per_zone
}

module "data" {
  source              = "../data"
  name                = var.name
  private_subnet_ids  = module.network.private_subnet_ids
  db_sg               = module.network.sg.db
  cache_sg            = module.network.sg.cache
  db_instance_class   = var.size.db_instance_class
  db_storage_gb       = var.size.db_storage_gb
  multi_az            = var.size.multi_az
  backup_days         = var.size.db_backup_days
  cache_node_type     = var.size.cache_node_type
  cache_nodes         = var.size.cache_nodes
  deletion_protection = var.size.deletion_protection
}

module "app" {
  source               = "../app"
  name                 = var.name
  app_env              = var.app_env
  vpc_id               = module.network.vpc_id
  public_subnet_ids    = module.network.public_subnet_ids
  private_subnet_ids   = module.network.private_subnet_ids
  sg                   = module.network.sg
  zone_id              = var.zone_id
  hosts                = var.hosts
  admin_cidrs          = var.admin_cidrs
  redis_url            = module.data.redis_url
  documents_bucket     = module.data.documents_bucket
  documents_bucket_arn = module.data.documents_bucket_arn
  kms_key_arn          = module.data.kms_key_arn
  message_allowlist    = var.message_allowlist
  optional_secrets     = var.optional_secrets
  simulate_providers   = var.simulate_providers
  desired              = var.size.desired
}

module "observability" {
  source             = "../observability"
  name               = var.name
  alert_email        = var.alert_email
  monthly_budget_usd = var.monthly_budget_usd
  alb_arn_suffix     = module.app.alb_arn_suffix
  target_groups      = module.app.target_group_arn_suffixes
  cluster            = module.app.cluster
  db_instance_id     = module.data.db_instance_id
  cache_id           = module.data.cache_id
  log_groups         = module.app.log_groups
}

module "backup" {
  source                = "../backup"
  providers             = { aws = aws, aws.copy = aws.copy }
  name                  = var.name
  kms_key_arn           = module.data.kms_key_arn
  keep_days             = var.size.backup_keep_days
  copy_to_second_region = var.size.copy_backups
  resources             = [module.data.db_instance_arn, module.data.documents_bucket_arn]
}

output "cluster" { value = module.app.cluster }
output "ecr" { value = module.app.ecr }
output "migrate_task_family" { value = module.app.migrate_task_family }
output "secrets" { value = module.app.secrets }
output "db_endpoint" { value = module.data.db_endpoint }
output "db_master_secret_arn" { value = module.data.db_master_secret_arn }
output "db_instance_id" { value = module.data.db_instance_id }
output "db_subnet_group" { value = module.data.db_subnet_group }
output "private_subnet_ids" { value = module.network.private_subnet_ids }
output "sg" { value = module.network.sg }
