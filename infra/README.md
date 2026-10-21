# EnergyGuard infrastructure

Everything here is code: monitoring, CI, the AWS server and deploys.

| Folder | What | Runs where |
|---|---|---|
| `prometheus/` | Scrapes `backend:8000/metrics` every 15 s, keeps 7 days | Compose profile `monitoring` |
| `grafana/` | Data source and the EnergyGuard dashboard, loaded at start-up | Compose profile `monitoring`, port 3000 |
| `jenkins/` | Jenkins configured from `casc.yaml`, runs the root `Jenkinsfile` on every branch | Your laptop, port 8080 |
| `terraform/` | One EC2 server that runs the whole stack | AWS, `ap-south-1` |
| `deploy.sh` | CD: updates the server to the latest `main` | Called by Jenkins |

## Monitoring (Grafana)

```sh
docker compose --profile team --profile monitoring up -d --build --wait
```

Open http://localhost:3000. Anyone can view the dashboard; log in as `admin` with
`GRAFANA_ADMIN_PASSWORD` from `.env` (default `admin` on a laptop) to edit.

## CI (Jenkins on your laptop)

```sh
docker compose -f infra/jenkins/docker-compose.yml --env-file .env up -d --build
```

Open http://localhost:8080 (user `admin`, password `JENKINS_ADMIN_PASSWORD` from `.env`, default `admin`).
The **EnergyGuard** job finds every branch on GitHub and checks for new commits every 2 minutes
(GitHub webhooks can't reach a laptop). It runs one build at a time.

Each build: validate Compose, backend lint and tests (also against PostgreSQL 16), every folder's
`ci.sh`, and the frontend and simulator images. On `main`, it then deploys to AWS (below).

## The AWS server (Terraform)

Needs an AWS user with `AmazonEC2FullAccess`, configured with `aws configure` (region `ap-south-1`).

```sh
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars   # put your IP in ssh_cidr: curl -s https://checkip.amazonaws.com
terraform init
terraform plan                                  # read what will be created
terraform apply
terraform output                                # dashboard_url, grafana_url, ssh
terraform output -raw grafana_admin_password
```

The server installs Docker, clones `main` and starts everything. First boot takes about 20 minutes:
the image builds, then 30 days of history are sent. Progress: `ssh ... 'tail -f /var/log/energyguard-setup.log'`.

Only ports 80 (dashboard) and 3000 (Grafana) are public; SSH is open to `ssh_cidr` only.
`energyguard.pem` (the SSH key) and `terraform.tfstate` stay on the machine that ran Terraform and are gitignored.

**Cost:** t3.small, 30 GB disk and a fixed IP. On the AWS Free plan this comes out of the credits.
Stop paying entirely with `terraform destroy`.

## CD (deploy after merge)

1. Put the server address in `.env`: `DEPLOY_HOST=` plus the output of `terraform output -raw public_ip`.
2. Restart Jenkins (the command above). It reads `DEPLOY_HOST` and the SSH key from `infra/terraform/`.
3. Every build of `main` now ends with **Deploy to AWS**: `infra/deploy.sh` pulls `main` on the server,
   rebuilds what changed and waits until `http://<server>/api/v1/health` answers.

By hand: `sh infra/deploy.sh <server-ip> infra/terraform/energyguard.pem`.

## Live demo

```sh
ssh -i infra/terraform/energyguard.pem ubuntu@<server-ip> \
  'cd /opt/energyguard && docker compose exec simulator python simulator.py --inject high_load_spike --meter M1 --minutes 3'
```

The alert appears on the dashboard within seconds, merges while the fault lasts, and shows in Grafana.
