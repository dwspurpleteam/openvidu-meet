
IMAGE ?= ghcr.io/dwspurpleteam/meet
override TAG := $(shell git rev-parse HEAD)
PLATFORM ?= linux/amd64

.PHONY: image-build
image-build:
	git archive --format=tar $(TAG) | docker buildx build --platform $(PLATFORM) --load -t $(IMAGE):$(TAG) -f meet-ce/docker/Dockerfile --build-arg BASE_HREF=/meet/ --build-arg GIT_COMMIT=$(TAG) -

.PHONY: image-push
image-push:
	docker push $(IMAGE):$(TAG)
