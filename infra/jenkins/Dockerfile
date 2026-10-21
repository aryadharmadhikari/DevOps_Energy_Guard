# Jenkins for EnergyGuard: configured entirely from casc.yaml, no setup wizard.
# It drives the host's Docker through the mounted socket, so it needs the Docker CLI and Compose.
FROM docker:29.8.2-cli AS docker-cli
FROM docker/compose-bin:v5.5.1 AS compose
FROM docker/buildx-bin:v0.37 AS buildx

FROM jenkins/jenkins:2.580.1-lts-jdk21
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=compose /docker-compose /usr/libexec/docker/cli-plugins/docker-compose
COPY --from=buildx /buildx /usr/libexec/docker/cli-plugins/docker-buildx
COPY plugins.txt /usr/share/jenkins/ref/plugins.txt
RUN jenkins-plugin-cli --plugin-file /usr/share/jenkins/ref/plugins.txt
# Outside /var/jenkins_home (a volume), so a rebuild always applies the current file.
COPY casc.yaml /usr/share/jenkins/casc.yaml
ENV CASC_JENKINS_CONFIG=/usr/share/jenkins/casc.yaml \
    JAVA_OPTS="-Djenkins.install.runSetupWizard=false"
