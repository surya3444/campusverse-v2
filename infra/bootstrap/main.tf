# Run once per AWS account (test, then live), by the owner, with an administrator profile:
#   terraform -chdir=infra/bootstrap init
#   terraform -chdir=infra/bootstrap apply -var environment=test -var github_repo=OWNER/REPO
# Creates the Terraform state bucket and the role GitHub Actions assumes (OIDC, no stored keys).
# State for this bootstrap itself stays local: keep it, or import the two resources later.

terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
}

variable "environment" {
  type = string
  validation {
    condition     = contains(["test", "live"], var.environment)
    error_message = "environment is test or live."
  }
}

variable "github_repo" {
  description = "owner/name of the GitHub repository allowed to deploy."
  type        = string
}

provider "aws" {
  region = "ap-south-1"
  default_tags { tags = { project = "campusverse", environment = var.environment } }
}

data "aws_caller_identity" "me" {}

resource "aws_s3_bucket" "state" {
  bucket = "campusverse-${var.environment}-tfstate-${data.aws_caller_identity.me.account_id}"
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_kms_key" "state" {
  description         = "Terraform state"
  enable_key_rotation = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.state.arn
    }
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

# A job in a GitHub environment presents "environment:<name>" as its subject. Test trusts its
# own deploy jobs and the promotion job (which pulls tested images); live trusts only jobs in the
# GitHub environment "production", which requires the owner's approval.
locals {
  subjects = var.environment == "test" ? [
    "repo:${var.github_repo}:environment:test",
    "repo:${var.github_repo}:environment:production",
  ] : ["repo:${var.github_repo}:environment:production"]
}

resource "aws_iam_role" "deploy" {
  name = "campusverse-github-deploy"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = local.subjects
        }
      }
    }]
  })
}

# Deploys push images, run the migration task and roll services. They never read secrets'
# values and can't change infrastructure; Terraform changes are applied by the owner.
resource "aws_iam_role_policy" "deploy" {
  role = aws_iam_role.deploy.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:CompleteLayerUpload",
          "ecr:GetDownloadUrlForLayer", "ecr:InitiateLayerUpload", "ecr:PutImage",
          "ecr:UploadLayerPart", "ecr:DescribeImages",
        ]
        Resource = "arn:aws:ecr:ap-south-1:${data.aws_caller_identity.me.account_id}:repository/campusverse/*"
      },
      {
        Effect = "Allow"
        Action = [
          "ecs:DescribeServices", "ecs:DescribeTaskDefinition", "ecs:DescribeTasks",
          "ecs:RegisterTaskDefinition", "ecs:RunTask", "ecs:UpdateService", "ecs:ListTasks",
        ]
        Resource = "*"
      },
      {
        Effect    = "Allow"
        Action    = ["iam:PassRole"]
        Resource  = "arn:aws:iam::${data.aws_caller_identity.me.account_id}:role/campusverse-*"
        Condition = { StringEquals = { "iam:PassedToService" = "ecs-tasks.amazonaws.com" } }
      },
      {
        # The monthly restore check (test account): restore a snapshot to a throwaway instance.
        Effect = "Allow"
        Action = [
          "rds:DescribeDBSnapshots", "rds:DescribeDBInstances", "rds:RestoreDBInstanceFromDBSnapshot",
          "rds:AddTagsToResource", "rds:DeleteDBInstance", "cloudwatch:PutMetricData",
        ]
        Resource = "*"
      },
    ]
  })
}

output "state_bucket" { value = aws_s3_bucket.state.bucket }
output "deploy_role_arn" { value = aws_iam_role.deploy.arn }
