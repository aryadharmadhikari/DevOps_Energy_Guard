output "dashboard_url" {
  value = "http://${aws_eip.energyguard.public_ip}"
}

output "grafana_url" {
  value = "http://${aws_eip.energyguard.public_ip}:3000"
}

output "public_ip" {
  value = aws_eip.energyguard.public_ip
}

output "ssh" {
  value = "ssh -i infra/terraform/energyguard.pem ubuntu@${aws_eip.energyguard.public_ip}"
}

output "grafana_admin_password" {
  value     = random_password.grafana.result
  sensitive = true
}
