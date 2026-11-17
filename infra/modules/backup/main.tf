# Daily AWS Backup of the database and documents, kept for a set number of days, with an
# optional copy to a second Indian region (Hyderabad) so data never leaves India.
# RDS also keeps its own automated backups (point-in-time recovery) from the data module.

terraform {
  required_providers {
    aws = {
      source                = "hashicorp/aws"
      configuration_aliases = [aws.copy]
    }
  }
}

variable "name" { type = string }
variable "kms_key_arn" { type = string }
variable "keep_days" { type = number }
variable "copy_to_second_region" { type = bool }
variable "resources" {
  description = "ARNs to back up: the database instance and the documents bucket."
  type        = list(string)
}

resource "aws_backup_vault" "main" {
  name        = var.name
  kms_key_arn = var.kms_key_arn
}

resource "aws_kms_key" "copy" {
  count               = var.copy_to_second_region ? 1 : 0
  provider            = aws.copy
  description         = "${var.name} backup copies"
  enable_key_rotation = true
}

resource "aws_backup_vault" "copy" {
  count       = var.copy_to_second_region ? 1 : 0
  provider    = aws.copy
  name        = "${var.name}-copy"
  kms_key_arn = aws_kms_key.copy[0].arn
}

resource "aws_backup_plan" "daily" {
  name = "${var.name}-daily"
  rule {
    rule_name         = "daily"
    target_vault_name = aws_backup_vault.main.name
    schedule          = "cron(0 21 * * ? *)" # 02:30 IST
    lifecycle { delete_after = var.keep_days }
    dynamic "copy_action" {
      for_each = var.copy_to_second_region ? [1] : []
      content {
        destination_vault_arn = aws_backup_vault.copy[0].arn
        lifecycle { delete_after = var.keep_days }
      }
    }
  }
}

resource "aws_iam_role" "backup" {
  name = "${var.name}-backup"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "backup.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy_attachment" "backup" {
  for_each = toset([
    "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup",
    "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForRestores",
    "arn:aws:iam::aws:policy/AWSBackupServiceRolePolicyForS3Backup",
    "arn:aws:iam::aws:policy/AWSBackupServiceRolePolicyForS3Restore",
  ])
  role       = aws_iam_role.backup.name
  policy_arn = each.value
}

resource "aws_backup_selection" "this" {
  name         = "${var.name}-data"
  plan_id      = aws_backup_plan.daily.id
  iam_role_arn = aws_iam_role.backup.arn
  resources    = var.resources
}
