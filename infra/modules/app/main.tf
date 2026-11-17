# The running product: image repositories, ECS Fargate services (api, worker, web, admin), the
# migration task, the public load balancer with a firewall, secrets and DNS.
# Deploys register new task definition revisions; Terraform creates the first and ignores the rest.

variable "name" { type = string }
variable "app_env" {
  description = "APP_ENV inside the containers: test or production."
  type        = string
}
variable "vpc_id" { type = string }
variable "public_subnet_ids" { type = list(string) }
variable "private_subnet_ids" { type = list(string) }
variable "sg" { type = map(string) }
variable "zone_id" {
  description = "Route 53 hosted zone for the domain."
  type        = string
}
variable "hosts" {
  description = "Host names: app (school web), admin (super admin), api (mobile app and webhooks)."
  type        = object({ app = string, admin = string, api = string })
}
variable "admin_cidrs" {
  description = "Networks allowed to open the admin portal. Empty allows everyone (passkeys still required)."
  type        = list(string)
  default     = []
}
variable "redis_url" { type = string }
variable "documents_bucket" { type = string }
variable "documents_bucket_arn" { type = string }
variable "kms_key_arn" { type = string }
variable "message_allowlist" {
  description = "Comma-separated E.164 numbers; outside the live environment only these receive messages."
  type        = string
  default     = ""
}
variable "simulate_providers" {
  description = "on: SMS and WhatsApp are simulated on screen (OTP codes shown to whoever asks). Synthetic data only."
  type        = string
  default     = "off"
  validation {
    condition     = contains(["on", "off"], var.simulate_providers)
    error_message = "simulate_providers is on or off."
  }
}
variable "optional_secrets" {
  description = "Optional integrations to wire, once their secret values exist: razorpay, anthropic, openai."
  type        = set(string)
  default     = []
}
variable "desired" {
  type = object({ api = number, worker = number, web = number, admin = number })
}
variable "log_days" {
  description = "CloudWatch log retention (CERT-In: at least 180 days; the guide asks for a year)."
  type        = number
  default     = 365
}
variable "initial_tag" {
  description = "Image tag for the first task definitions; deploys replace it."
  type        = string
  default     = "bootstrap"
}

data "aws_caller_identity" "me" {}
data "aws_region" "here" {}

locals {
  services = toset(["api", "worker", "migrate", "web", "admin"])
  image    = { for s in local.services : s => "${aws_ecr_repository.this[s].repository_url}:${var.initial_tag}" }
  secret_names = concat(
    ["database-url", "migration-database-url", "auth-pepper", "field-keys"],
    contains(var.optional_secrets, "razorpay") ? ["razorpay-key-id", "razorpay-key-secret", "razorpay-webhook-secret"] : [],
    contains(var.optional_secrets, "anthropic") ? ["anthropic-api-key"] : [],
    contains(var.optional_secrets, "openai") ? ["openai-api-key"] : [],
  )
  secret_env = {
    "database-url"            = "DATABASE_URL"
    "migration-database-url"  = "MIGRATION_DATABASE_URL"
    "auth-pepper"             = "AUTH_PEPPER"
    "field-keys"              = "FIELD_KEYS"
    "razorpay-key-id"         = "RAZORPAY_KEY_ID"
    "razorpay-key-secret"     = "RAZORPAY_KEY_SECRET"
    "razorpay-webhook-secret" = "RAZORPAY_WEBHOOK_SECRET"
    "anthropic-api-key"       = "ANTHROPIC_API_KEY"
    "openai-api-key"          = "OPENAI_API_KEY"
  }
  # Everything the API and worker read (loadEnv validates it at start).
  server_env = [
    { name = "APP_ENV", value = var.app_env },
    { name = "API_PORT", value = "4000" },
    { name = "API_HOST", value = "0.0.0.0" },
    { name = "REDIS_URL", value = var.redis_url },
    { name = "S3_BUCKET", value = var.documents_bucket },
    { name = "S3_REGION", value = data.aws_region.here.region },
    { name = "PUBLIC_VERIFY_BASE_URL", value = "https://${var.hosts.app}/verify" },
    { name = "ADMIN_ORIGIN", value = "https://${var.hosts.admin}" },
    { name = "MESSAGE_ALLOWLIST", value = var.message_allowlist },
    { name = "SIMULATE_PROVIDERS", value = var.simulate_providers },
  ]
  server_secrets = [
    for n in local.secret_names : { name = local.secret_env[n], valueFrom = aws_secretsmanager_secret.this[n].arn }
    if n != "migration-database-url"
  ]
}

# ---------------------------------------------------------------------------------- images

resource "aws_ecr_repository" "this" {
  for_each             = local.services
  name                 = "campusverse/${each.key}"
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration { scan_on_push = true }
  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = var.kms_key_arn
  }
}

resource "aws_ecr_lifecycle_policy" "this" {
  for_each   = local.services
  repository = aws_ecr_repository.this[each.key].name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last 50 images"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 50 }
      action       = { type = "expire" }
    }]
  })
}

# ---------------------------------------------------------------------------------- secrets

# Shells only: the owner puts each value in with the console or CLI, so values never enter
# Terraform state. A task won't start until its secrets have values.
resource "aws_secretsmanager_secret" "this" {
  for_each   = toset(local.secret_names)
  name       = "${var.name}/${each.key}"
  kms_key_id = var.kms_key_arn
}

# ---------------------------------------------------------------------------------- roles

resource "aws_iam_role" "execution" {
  name = "campusverse-${var.app_env}-execution"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "ecs-tasks.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "execution_secrets" {
  role = aws_iam_role.execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = [for s in aws_secretsmanager_secret.this : s.arn] },
      { Effect = "Allow", Action = ["kms:Decrypt"], Resource = [var.kms_key_arn] },
    ]
  })
}

data "aws_iam_policy_document" "task_trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# The API and worker read and write documents; web, admin and migrate need no AWS access.
resource "aws_iam_role" "server" {
  name               = "campusverse-${var.app_env}-server"
  assume_role_policy = data.aws_iam_policy_document.task_trust.json
}

resource "aws_iam_role_policy" "server" {
  role = aws_iam_role.server.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject", "s3:GetObjectTagging"], Resource = ["${var.documents_bucket_arn}/*"] },
      { Effect = "Allow", Action = ["kms:Decrypt", "kms:GenerateDataKey"], Resource = [var.kms_key_arn] },
      # ECS Exec for time-limited, logged support sessions.
      {
        Effect   = "Allow"
        Action   = ["ssmmessages:CreateControlChannel", "ssmmessages:CreateDataChannel", "ssmmessages:OpenControlChannel", "ssmmessages:OpenDataChannel"]
        Resource = "*"
      },
    ]
  })
}

resource "aws_iam_role" "plain" {
  name               = "campusverse-${var.app_env}-plain"
  assume_role_policy = data.aws_iam_policy_document.task_trust.json
}

# ---------------------------------------------------------------------------------- cluster

resource "aws_cloudwatch_log_group" "service" {
  for_each          = local.services
  name              = "/campusverse/${var.app_env}/${each.key}"
  retention_in_days = var.log_days
  kms_key_id        = var.kms_key_arn
}

resource "aws_cloudwatch_log_group" "exec" {
  name              = "/campusverse/${var.app_env}/exec-sessions"
  retention_in_days = var.log_days
  kms_key_id        = var.kms_key_arn
}

resource "aws_service_discovery_http_namespace" "this" {
  name = "${var.name}.internal"
}

resource "aws_ecs_cluster" "this" {
  name = var.name
  setting {
    name  = "containerInsights"
    value = "enhanced"
  }
  service_connect_defaults { namespace = aws_service_discovery_http_namespace.this.arn }
  configuration {
    execute_command_configuration {
      kms_key_id = var.kms_key_arn
      logging    = "OVERRIDE"
      log_configuration {
        cloud_watch_log_group_name     = aws_cloudwatch_log_group.exec.name
        cloud_watch_encryption_enabled = true
      }
    }
  }
}

locals {
  log = { for s in local.services : s => {
    logDriver = "awslogs"
    options = {
      "awslogs-group"         = aws_cloudwatch_log_group.service[s].name
      "awslogs-region"        = data.aws_region.here.region
      "awslogs-stream-prefix" = s
    }
  } }
  tasks = {
    api = {
      cpu = 512, memory = 1024, role = aws_iam_role.server.arn, port = 4000
      env = local.server_env, secrets = local.server_secrets
    }
    worker = {
      cpu = 512, memory = 1024, role = aws_iam_role.server.arn, port = null
      env = local.server_env, secrets = local.server_secrets
    }
    migrate = {
      cpu     = 256, memory = 512, role = aws_iam_role.plain.arn, port = null, env = []
      secrets = [{ name = "MIGRATION_DATABASE_URL", valueFrom = aws_secretsmanager_secret.this["migration-database-url"].arn }]
    }
    web = {
      cpu = 256, memory = 512, role = aws_iam_role.plain.arn, port = 3000, secrets = []
      env = [
        { name = "APP_ENV", value = var.app_env },
        { name = "API_URL", value = "http://api:4000" },
        { name = "SIMULATE_PROVIDERS", value = var.simulate_providers },
      ]
    }
    admin = {
      cpu = 256, memory = 512, role = aws_iam_role.plain.arn, port = 3001, secrets = []
      env = [
        { name = "APP_ENV", value = var.app_env },
        { name = "API_URL", value = "http://api:4000" },
        { name = "SIMULATE_PROVIDERS", value = var.simulate_providers },
      ]
    }
  }
}

resource "aws_ecs_task_definition" "this" {
  for_each                 = local.tasks
  family                   = "${var.name}-${each.key}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = each.value.cpu
  memory                   = each.value.memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = each.value.role
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }
  container_definitions = jsonencode([{
    name                   = each.key
    image                  = local.image[each.key]
    essential              = true
    readonlyRootFilesystem = false
    environment            = each.value.env
    secrets                = each.value.secrets
    logConfiguration       = local.log[each.key]
    portMappings           = each.value.port == null ? [] : [{ name = "http", containerPort = each.value.port, protocol = "tcp" }]
  }])
  lifecycle { ignore_changes = [container_definitions] }
}

# ---------------------------------------------------------------------------------- load balancer

resource "aws_acm_certificate" "this" {
  domain_name               = var.hosts.app
  subject_alternative_names = [var.hosts.admin, var.hosts.api]
  validation_method         = "DNS"
  lifecycle { create_before_destroy = true }
}

resource "aws_route53_record" "validation" {
  for_each = { for o in aws_acm_certificate.this.domain_validation_options : o.domain_name => o }
  zone_id  = var.zone_id
  name     = each.value.resource_record_name
  type     = each.value.resource_record_type
  records  = [each.value.resource_record_value]
  ttl      = 300
}

resource "aws_acm_certificate_validation" "this" {
  certificate_arn         = aws_acm_certificate.this.arn
  validation_record_fqdns = [for r in aws_route53_record.validation : r.fqdn]
}

# The public entry point by design, behind the firewall below.
#trivy:ignore:AVD-AWS-0053
resource "aws_lb" "this" {
  name                       = var.name
  load_balancer_type         = "application"
  subnets                    = var.public_subnet_ids
  security_groups            = [var.sg.alb]
  drop_invalid_header_fields = true
  enable_deletion_protection = var.app_env == "production"
}

resource "aws_lb_target_group" "this" {
  for_each    = { api = 4000, web = 3000, admin = 3001 }
  name        = "${var.name}-${each.key}"
  port        = each.value
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = var.vpc_id
  health_check {
    path    = each.key == "api" ? "/api/v1/health" : each.key == "admin" ? "/sign-in" : "/login"
    matcher = "200"
  }
  deregistration_delay = 30
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.this.certificate_arn
  # HSTS on every response, the API's included.
  routing_http_response_strict_transport_security_header_value = "max-age=31536000; includeSubDomains"
  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "Not found"
      status_code  = "404"
    }
  }
}

# The admin API is reachable only inside the network (from the admin service), never publicly.
resource "aws_lb_listener_rule" "no_public_admin_api" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 5
  condition {
    path_pattern { values = ["/api/v1/admin", "/api/v1/admin/*"] }
  }
  action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "Not found"
      status_code  = "404"
    }
  }
}

resource "aws_lb_listener_rule" "admin" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 10
  condition {
    host_header { values = [var.hosts.admin] }
  }
  condition {
    source_ip { values = length(var.admin_cidrs) > 0 ? var.admin_cidrs : ["0.0.0.0/0", "::/0"] }
  }
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.this["admin"].arn
  }
}

resource "aws_lb_listener_rule" "api" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 20
  condition {
    host_header { values = [var.hosts.api] }
  }
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.this["api"].arn
  }
}

resource "aws_lb_listener_rule" "web" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 30
  condition {
    host_header { values = [var.hosts.app] }
  }
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.this["web"].arn
  }
}

resource "aws_route53_record" "host" {
  for_each = var.hosts
  zone_id  = var.zone_id
  name     = each.value
  type     = "A"
  alias {
    name                   = aws_lb.this.dns_name
    zone_id                = aws_lb.this.zone_id
    evaluate_target_health = true
  }
}

# Firewall: AWS managed rules and a per-address rate limit.
resource "aws_wafv2_web_acl" "this" {
  name  = var.name
  scope = "REGIONAL"
  default_action {
    allow {}
  }
  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = var.name
    sampled_requests_enabled   = false
  }
  rule {
    name     = "common"
    priority = 1
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
        # Imports upload Excel files larger than the rule set's 8 KB body limit.
        rule_action_override {
          name = "SizeRestrictions_BODY"
          action_to_use {
            count {}
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name}-common"
      sampled_requests_enabled   = false
    }
  }
  rule {
    name     = "bad-inputs"
    priority = 2
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
        vendor_name = "AWS"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name}-bad-inputs"
      sampled_requests_enabled   = false
    }
  }
  rule {
    name     = "rate"
    priority = 3
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit              = 2000
        aggregate_key_type = "IP"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name}-rate"
      sampled_requests_enabled   = false
    }
  }
}

resource "aws_wafv2_web_acl_association" "this" {
  resource_arn = aws_lb.this.arn
  web_acl_arn  = aws_wafv2_web_acl.this.arn
}

# ---------------------------------------------------------------------------------- services

# Rolls a deployment back when the new version answers with errors.
resource "aws_cloudwatch_metric_alarm" "deploy_5xx" {
  for_each            = aws_lb_target_group.this
  alarm_name          = "${var.name}-${each.key}-deploy-5xx"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_Target_5XX_Count"
  dimensions          = { LoadBalancer = aws_lb.this.arn_suffix, TargetGroup = each.value.arn_suffix }
  statistic           = "Sum"
  period              = 60
  evaluation_periods  = 3
  threshold           = 10
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
}

resource "aws_ecs_service" "this" {
  for_each                           = { for k, v in var.desired : k => v }
  name                               = each.key
  cluster                            = aws_ecs_cluster.this.id
  task_definition                    = aws_ecs_task_definition.this[each.key].arn
  desired_count                      = each.value
  launch_type                        = "FARGATE"
  enable_execute_command             = contains(["api", "worker"], each.key)
  health_check_grace_period_seconds  = each.key == "worker" ? null : 60
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  propagate_tags                     = "SERVICE"
  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.sg.app]
    assign_public_ip = false
  }
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  dynamic "alarms" {
    for_each = each.key == "worker" ? [] : [1]
    content {
      enable      = true
      rollback    = true
      alarm_names = [aws_cloudwatch_metric_alarm.deploy_5xx[each.key].alarm_name]
    }
  }
  dynamic "load_balancer" {
    for_each = each.key == "worker" ? [] : [1]
    content {
      target_group_arn = aws_lb_target_group.this[each.key].arn
      container_name   = each.key
      container_port   = local.tasks[each.key].port
    }
  }
  service_connect_configuration {
    enabled = true
    dynamic "service" {
      for_each = each.key == "api" ? [1] : []
      content {
        port_name = "http"
        client_alias {
          port     = 4000
          dns_name = "api"
        }
      }
    }
  }
  # Deploys move the task definition; Terraform doesn't fight them.
  lifecycle { ignore_changes = [task_definition] }
  depends_on = [aws_lb_listener.https]
}

output "cluster" { value = aws_ecs_cluster.this.name }
output "alb_arn_suffix" { value = aws_lb.this.arn_suffix }
output "target_group_arn_suffixes" { value = { for k, v in aws_lb_target_group.this : k => v.arn_suffix } }
output "log_groups" { value = { for k, v in aws_cloudwatch_log_group.service : k => v.name } }
output "ecr" { value = { for k, v in aws_ecr_repository.this : k => v.repository_url } }
output "migrate_task_family" { value = aws_ecs_task_definition.this["migrate"].family }
output "secrets" { value = { for k, v in aws_secretsmanager_secret.this : k => v.name } }
