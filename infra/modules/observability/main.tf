# Alarms to one email topic, a monthly budget, and log-based signals. AWS tools only, so no
# student data leaves the account for monitoring.

variable "name" { type = string }
variable "alert_email" { type = string }
variable "monthly_budget_usd" { type = number }
variable "alb_arn_suffix" { type = string }
variable "target_groups" { type = map(string) }
variable "cluster" { type = string }
variable "db_instance_id" { type = string }
variable "cache_id" { type = string }
variable "log_groups" { type = map(string) }

data "aws_caller_identity" "me" {}

# Alarms and budgets publish to an encrypted topic only if the key lets their services use it.
resource "aws_kms_key" "alerts" {
  description         = "${var.name} alert topic"
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
        Sid       = "AlarmsAndBudgets"
        Effect    = "Allow"
        Principal = { Service = ["cloudwatch.amazonaws.com", "budgets.amazonaws.com"] }
        Action    = ["kms:Decrypt", "kms:GenerateDataKey*"]
        Resource  = "*"
      },
    ]
  })
}

resource "aws_sns_topic" "alerts" {
  name              = "${var.name}-alerts"
  kms_master_key_id = aws_kms_key.alerts.arn
}

resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

locals {
  alarms = {
    "alb-5xx" = {
      ns   = "AWS/ApplicationELB", metric = "HTTPCode_ELB_5XX_Count", stat = "Sum", threshold = 20, op = "GreaterThanThreshold"
      dims = { LoadBalancer = var.alb_arn_suffix }
    }
    "db-cpu" = {
      ns   = "AWS/RDS", metric = "CPUUtilization", stat = "Average", threshold = 80, op = "GreaterThanThreshold"
      dims = { DBInstanceIdentifier = var.db_instance_id }
    }
    "db-storage" = {
      ns   = "AWS/RDS", metric = "FreeStorageSpace", stat = "Minimum", threshold = 10 * 1024 * 1024 * 1024, op = "LessThanThreshold"
      dims = { DBInstanceIdentifier = var.db_instance_id }
    }
    "db-memory" = {
      ns   = "AWS/RDS", metric = "FreeableMemory", stat = "Minimum", threshold = 256 * 1024 * 1024, op = "LessThanThreshold"
      dims = { DBInstanceIdentifier = var.db_instance_id }
    }
    # BullMQ can't evict: full memory means jobs stop.
    "cache-memory" = {
      ns   = "AWS/ElastiCache", metric = "DatabaseMemoryUsagePercentage", stat = "Maximum", threshold = 75, op = "GreaterThanThreshold"
      dims = { ReplicationGroupId = var.cache_id }
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "this" {
  for_each            = local.alarms
  alarm_name          = "${var.name}-${each.key}"
  namespace           = each.value.ns
  metric_name         = each.value.metric
  dimensions          = each.value.dims
  statistic           = each.value.stat
  period              = 300
  evaluation_periods  = 2
  threshold           = each.value.threshold
  comparison_operator = each.value.op
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "unhealthy" {
  for_each            = var.target_groups
  alarm_name          = "${var.name}-${each.key}-unhealthy"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "UnHealthyHostCount"
  dimensions          = { LoadBalancer = var.alb_arn_suffix, TargetGroup = each.value }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 3
  threshold           = 0
  comparison_operator = "GreaterThanThreshold"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

# The worker must always run: it relays the outbox (notifications, payments, imports).
resource "aws_cloudwatch_metric_alarm" "worker_down" {
  alarm_name          = "${var.name}-worker-down"
  namespace           = "ECS/ContainerInsights"
  metric_name         = "RunningTaskCount"
  dimensions          = { ClusterName = var.cluster, ServiceName = "worker" }
  statistic           = "Minimum"
  period              = 60
  evaluation_periods  = 5
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
}

# Log signals: the outbox relay failing, and server errors (5xx) logged by the API.
resource "aws_cloudwatch_log_metric_filter" "relay_failed" {
  name           = "${var.name}-relay-failed"
  log_group_name = var.log_groups["worker"]
  pattern        = "\"relay failed\""
  metric_transformation {
    name      = "RelayFailures"
    namespace = "CampusVerse/${var.name}"
    value     = "1"
  }
}

resource "aws_cloudwatch_metric_alarm" "relay_failed" {
  alarm_name          = "${var.name}-relay-failed"
  namespace           = "CampusVerse/${var.name}"
  metric_name         = "RelayFailures"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 5
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

resource "aws_budgets_budget" "monthly" {
  name         = "${var.name}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.alert_email]
  }
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }
}

output "alerts_topic_arn" { value = aws_sns_topic.alerts.arn }
