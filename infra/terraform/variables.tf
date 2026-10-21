variable "region" {
  description = "AWS region. Mumbai is closest to the users."
  type        = string
  default     = "ap-south-1"
}

variable "instance_type" {
  description = "t3.small (2 GB) is free-plan eligible on new accounts and fits all containers."
  type        = string
  default     = "t3.small"
}

variable "ssh_cidr" {
  description = "Who may SSH in (and Jenkins deploys from): your public IP as a /32, e.g. 49.36.10.20/32."
  type        = string
}

variable "repo_url" {
  description = "Git repository the server runs."
  type        = string
  default     = "https://github.com/aryadharmadhikari/DevOps_Energy_Guard.git"
}

variable "branch" {
  description = "Branch the server runs (CD redeploys this branch)."
  type        = string
  default     = "main"
}

variable "disk_gb" {
  description = "Root disk size. Docker images, PostgreSQL and 7 days of Prometheus fit in 30 GB."
  type        = number
  default     = 30
}
