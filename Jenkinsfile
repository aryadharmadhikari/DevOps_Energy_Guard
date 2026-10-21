pipeline {
    agent any
    options {
        timestamps()
        disableConcurrentBuilds()
        timeout(time: 20, unit: 'MINUTES')
    }
    environment {
        COMPOSE_PROJECT_NAME = "energyguard-ci-${BUILD_NUMBER}"
        ML_SCORER = 'stub'
    }
    stages {
        stage('Validate Compose') {
            steps {
                sh 'docker compose --profile team --profile monitoring config --quiet'
            }
        }
        stage('Backend lint and build') {
            steps {
                sh 'docker build --target test -t "$COMPOSE_PROJECT_NAME-tests" -f backend/Dockerfile .'
                sh 'docker run --rm "$COMPOSE_PROJECT_NAME-tests" sh -c "ruff check . && ruff format --check ."'
            }
        }
        stage('PostgreSQL 16 integration') {
            steps {
                sh 'docker compose up --build --wait db backend'
                sh '''docker run --rm --network "${COMPOSE_PROJECT_NAME}_default" \
                    -e "TEST_DATABASE_URL=postgresql://energyguard:energyguard@db:5432/energyguard" \
                    "$COMPOSE_PROJECT_NAME-tests" pytest -q'''
            }
        }
        stage('Available teammate checks') {
            steps {
                // Owners add ci.sh with lint and tests. Missing code is reported explicitly.
                sh '''set -eu
                    for part in ml frontend simulator notifier infra; do
                        if [ -f "$part/ci.sh" ]; then
                            (cd "$part" && sh ci.sh)
                        elif find "$part" -type f ! -name .gitkeep | grep -q .; then
                            echo "ERROR: $part has source but no ci.sh for lint and tests"
                            exit 1
                        else
                            echo "SKIP: $part has not been delivered yet"
                        fi
                    done'''
            }
        }
        stage('Available teammate images') {
            steps {
                sh '''set -eu
                    for part in frontend simulator notifier; do
                        if [ -f "$part/Dockerfile" ]; then
                            docker compose build "$part"
                        else
                            echo "SKIP: $part/Dockerfile has not been delivered yet"
                        fi
                    done'''
            }
        }
        stage('Deploy to AWS') {
            // CD: only main, and only once the server exists (DEPLOY_HOST comes from terraform output).
            when {
                allOf {
                    branch 'main'
                    expression { env.DEPLOY_HOST?.trim() }
                }
            }
            steps {
                sh 'sh infra/deploy.sh "$DEPLOY_HOST" /deploy/energyguard.pem'
            }
        }
    }
    post {
        always {
            sh 'docker compose logs --no-color --tail=100 || true'
            sh 'docker compose down --volumes --remove-orphans || true'
            sh 'docker image rm "$COMPOSE_PROJECT_NAME-tests" || true'
        }
    }
}
