# One EC2 server that runs the whole stack with Docker Compose (contract section 7, step 8).

data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical
  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }
}

data "aws_vpc" "default" {
  default = true
}

# SSH key made here; the private half is saved next to this file (gitignored) for SSH and CD.
resource "tls_private_key" "ssh" {
  algorithm = "ED25519"
}

resource "aws_key_pair" "energyguard" {
  key_name   = "energyguard"
  public_key = tls_private_key.ssh.public_key_openssh
}

resource "local_sensitive_file" "ssh_key" {
  content         = tls_private_key.ssh.private_key_openssh
  filename        = "${path.module}/energyguard.pem"
  file_permission = "0600"
}

resource "random_password" "grafana" {
  length  = 20
  special = false
}

resource "aws_security_group" "energyguard" {
  name        = "energyguard"
  description = "EnergyGuard: dashboard and Grafana public, SSH from one address"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "Dashboard (nginx, which also forwards /api to the backend)"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    description = "Grafana (anyone can view, only admin can edit)"
    from_port   = 3000
    to_port     = 3000
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    description = "SSH for deploys"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.ssh_cidr]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_instance" "energyguard" {
  ami                    = data.aws_ami.ubuntu.id
  instance_type          = var.instance_type
  key_name               = aws_key_pair.energyguard.key_name
  vpc_security_group_ids = [aws_security_group.energyguard.id]

  # Burst credits only, never paid "unlimited" CPU.
  credit_specification {
    cpu_credits = "standard"
  }

  metadata_options {
    http_tokens = "required" # IMDSv2
  }

  root_block_device {
    volume_type = "gp3"
    volume_size = var.disk_gb
    encrypted   = true
  }

  user_data = templatefile("${path.module}/user_data.sh.tftpl", {
    repo_url         = var.repo_url
    branch           = var.branch
    grafana_password = random_password.grafana.result
  })
  user_data_replace_on_change = true

  tags = { Name = "energyguard" }
}

# A fixed address, so the URL and the CD target survive a stop and start.
resource "aws_eip" "energyguard" {
  instance = aws_instance.energyguard.id
  domain   = "vpc"
}
