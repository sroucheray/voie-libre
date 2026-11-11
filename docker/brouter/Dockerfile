# BRouter at the commit validated by the spike (see spike/brouter/RAPPORT.md).
# It follows the Dockerfile of that commit but needs no BuildKit feature (no --platform, no cache
# mount, no COPY --chmod), so it builds with the classic builder as well as on GitHub Actions.
#   docker build -f docker/brouter/Dockerfile -t voie-libre/brouter docker/brouter
ARG BROUTER_REF=fed8f185ecdba4c01f4d6913bff7c0fae4576a32

FROM eclipse-temurin:17-jdk-jammy AS build
ARG BROUTER_REF
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /brouter
RUN git clone --quiet https://github.com/abrensch/brouter.git . \
    && git checkout --quiet "$BROUTER_REF"
RUN sed -i 's/\r$//' gradlew && chmod +x gradlew
RUN ./gradlew --no-daemon clean build

FROM eclipse-temurin:17-jre-jammy
RUN groupadd --gid 1000 brouter \
    && useradd --uid 1000 --gid brouter --home-dir /app --no-create-home brouter \
    && mkdir -p /app /segments4 /customprofiles \
    && chown brouter:brouter /app /segments4 /customprofiles
WORKDIR /app
COPY --from=build /brouter/brouter-server/build/libs/brouter-*-all.jar /app/brouter.jar
COPY --from=build /brouter/misc/scripts/standalone/server.sh /app/server.sh
RUN chmod 755 /app/server.sh
COPY --from=build /brouter/misc/profiles2/ /profiles2/
ENV CLASSPATH=/app/brouter.jar \
    SEGMENTSPATH=/segments4 \
    PROFILESPATH=/profiles2 \
    CUSTOMPROFILESPATH=/customprofiles
USER brouter
EXPOSE 17777
CMD ["/app/server.sh"]
