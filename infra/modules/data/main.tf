# PostgreSQL 18 (source of truth), Valkey for BullMQ and caches (never the source of truth),
# and the private documents bucket. All encrypted with one customer-managed key, all private.

variable "name" { type = string }
variable "private_subnet_ids" { type = list(string) }
variable "db_sg" { type = string }
variable "cache_sg" { type = string }
variable "db_instance_class" { type = string }
variable "db_storage_gb" { type = number }
variable "multi_az" { type = bool }
variable "backup_days" { type = number }
variable "cache_node_type" { type = string }
variable "cache_nodes" {
  description = "2 or more for automatic failover (live); 1 for test."
  type        = number
}
variable "deletion_protection" { type = bool }

data "aws_caller_identity" "me" {}
data "aws_region" "here" {}

# Services using the key through the caller (RDS, ElastiCache, S3, ECR, Secrets Manager, Backup)
# need only the account statement; CloudWatch Logs must be named in the key policy.
resource "aws_kms_key" "data" {
  description         = "${var.name} data at rest"
  enable_key_rotation = true
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "Account"
        Effect    = "Allow"
        Principal = { AWS = "arn:aws:iam::${data.aws_caller_identity.me.account_id}:root" }
        Action    = "kms:*"
        Resource  = "*"
      },
      {
        Sid       = "Logs"
        Effect    = "Allow"
        Principal = { Service = "logs.${data.aws_region.here.region}.amazonaws.com" }
        Action    = ["kms:Encrypt*", "kms:Decrypt*", "kms:ReEncrypt*", "kms:GenerateDataKey*", "kms:Describe*"]
        Resource  = "*"
        Condition = {
          ArnLike = {
            "kms:EncryptionContext:aws:logs:arn" = "arn:aws:logs:${data.aws_region.here.region}:${data.aws_caller_identity.me.account_id}:log-group:*"
          }
        }
      },
    ]
  })
}

resource "aws_kms_alias" "data" {
  name          = "alias/${var.name}-data"
  target_key_id = aws_kms_key.data.key_id
}

resource "aws_db_subnet_group" "this" {
  name       = var.name
  subnet_ids = var.private_subnet_ids
}

resource "aws_db_parameter_group" "pg18" {
  name   = "${var.name}-pg18"
  family = "postgres18"
  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
  # Slow queries in the log (statement text only; parameters, which may hold personal data, are not logged).
  parameter {
    name  = "log_min_duration_statement"
    value = "1000"
  }
  parameter {
    name  = "idle_in_transaction_session_timeout"
    value = "60000"
  }
}

resource "aws_db_instance" "main" {
  identifier                      = var.name
  engine                          = "postgres"
  engine_version                  = "18"
  instance_class                  = var.db_instance_class
  allocated_storage               = var.db_storage_gb
  max_allocated_storage           = var.db_storage_gb * 4
  storage_type                    = "gp3"
  storage_encrypted               = true
  kms_key_id                      = aws_kms_key.data.arn
  db_name                         = "campusverse"
  username                        = "campusverse_admin"
  manage_master_user_password     = true
  db_subnet_group_name            = aws_db_subnet_group.this.name
  vpc_security_group_ids          = [var.db_sg]
  parameter_group_name            = aws_db_parameter_group.pg18.name
  multi_az                        = var.multi_az
  publicly_accessible             = false
  backup_retention_period         = var.backup_days
  backup_window                   = "20:30-21:30" # 02:00-03:00 IST
  maintenance_window              = "sun:21:30-sun:22:30"
  copy_tags_to_snapshot           = true
  deletion_protection             = var.deletion_protection
  skip_final_snapshot             = false
  final_snapshot_identifier       = "${var.name}-final"
  performance_insights_enabled    = true
  performance_insights_kms_key_id = aws_kms_key.data.arn
  enabled_cloudwatch_logs_exports = ["postgresql"]
  auto_minor_version_upgrade      = true
}

resource "aws_elasticache_subnet_group" "this" {
  name       = var.name
  subnet_ids = var.private_subnet_ids
}

# BullMQ needs noeviction: queued jobs must never be dropped to free memory.
resource "aws_elasticache_parameter_group" "valkey" {
  name   = "${var.name}-valkey8"
  family = "valkey8"
  parameter {
    name  = "maxmemory-policy"
    value = "noeviction"
  }
}

resource "aws_elasticache_replication_group" "this" {
  replication_group_id       = var.name
  description                = "${var.name} queues and caches"
  engine                     = "valkey"
  engine_version             = "8.0"
  node_type                  = var.cache_node_type
  num_cache_clusters         = var.cache_nodes
  automatic_failover_enabled = var.cache_nodes > 1
  multi_az_enabled           = var.cache_nodes > 1
  parameter_group_name       = aws_elasticache_parameter_group.valkey.name
  subnet_group_name          = aws_elasticache_subnet_group.this.name
  security_group_ids         = [var.cache_sg]
  at_rest_encryption_enabled = true
  kms_key_id                 = aws_kms_key.data.arn
  transit_encryption_enabled = true
  snapshot_retention_limit   = 1
}

resource "aws_s3_bucket" "documents" {
  bucket = "${var.name}-documents"
}

resource "aws_s3_bucket_versioning" "documents" {
  bucket = aws_s3_bucket.documents.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.data.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "documents" {
  bucket                  = aws_s3_bucket.documents.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "documents" {
  bucket = aws_s3_bucket.documents.id
  rule { object_ownership = "BucketOwnerEnforced" }
}

resource "aws_s3_bucket_lifecycle_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id
  rule {
    id     = "old-versions"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration { noncurrent_days = 90 }
    abort_incomplete_multipart_upload { days_after_initiation = 2 }
  }
}

resource "aws_s3_bucket_policy" "documents_tls" {
  bucket = aws_s3_bucket.documents.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "TLSOnly"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [aws_s3_bucket.documents.arn, "${aws_s3_bucket.documents.arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })
}

output "kms_key_arn" { value = aws_kms_key.data.arn }
output "db_instance_id" { value = aws_db_instance.main.identifier }
output "db_instance_arn" { value = aws_db_instance.main.arn }
output "db_endpoint" { value = aws_db_instance.main.address }
output "db_master_secret_arn" { value = aws_db_instance.main.master_user_secret[0].secret_arn }
output "db_subnet_group" { value = aws_db_subnet_group.this.name }
output "redis_url" {
  value = "rediss://${aws_elasticache_replication_group.this.primary_endpoint_address}:6379"
}
output "cache_id" { value = aws_elasticache_replication_group.this.id }
output "documents_bucket" { value = aws_s3_bucket.documents.bucket }
output "documents_bucket_arn" { value = aws_s3_bucket.documents.arn }

# Malware scanning of every uploaded document (GuardDuty Malware Protection for S3). GuardDuty
# tags each object with GuardDutyMalwareScanStatus; the worker waits for that tag.
resource "aws_iam_role" "malware_scan" {
  name = "${var.name}-malware-scan"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "malware-protection-plan.guardduty.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "malware_scan" {
  role = aws_iam_role.malware_scan.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["events:PutRule", "events:DeleteRule", "events:PutTargets", "events:RemoveTargets"]
        Resource = "arn:aws:events:${data.aws_region.here.region}:${data.aws_caller_identity.me.account_id}:rule/DO-NOT-DELETE-AmazonGuardDutyMalwareProtectionS3*"
        Condition = {
          StringLike = { "events:ManagedBy" = "malware-protection-plan.guardduty.amazonaws.com" }
        }
      },
      {
        Effect   = "Allow"
        Action   = ["events:DescribeRule", "events:ListTargetsByRule"]
        Resource = "arn:aws:events:${data.aws_region.here.region}:${data.aws_caller_identity.me.account_id}:rule/DO-NOT-DELETE-AmazonGuardDutyMalwareProtectionS3*"
      },
      {
        Effect   = "Allow"
        Action   = ["s3:PutBucketNotification", "s3:GetBucketNotification", "s3:ListBucket"]
        Resource = aws_s3_bucket.documents.arn
      },
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject", "s3:GetObjectVersion", "s3:GetObjectTagging", "s3:GetObjectVersionTagging",
          "s3:PutObjectTagging", "s3:PutObjectVersionTagging",
        ]
        Resource = "${aws_s3_bucket.documents.arn}/*"
      },
      {
        Effect   = "Allow"
        Action   = ["s3:PutObject"]
        Resource = "${aws_s3_bucket.documents.arn}/malware-protection-resource-validation-object"
      },
      {
        Effect   = "Allow"
        Action   = ["kms:GenerateDataKey", "kms:Decrypt"]
        Resource = aws_kms_key.data.arn
        Condition = {
          StringLike = { "kms:ViaService" = "s3.*.amazonaws.com" }
        }
      },
    ]
  })
}

resource "aws_guardduty_malware_protection_plan" "documents" {
  role = aws_iam_role.malware_scan.arn
  protected_resource {
    s3_bucket { bucket_name = aws_s3_bucket.documents.bucket }
  }
  actions {
    tagging { status = "ENABLED" }
  }
}
