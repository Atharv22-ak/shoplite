.RECIPEPREFIX = >
REGISTRY ?= rwxatharv
TAG      ?= v1
PLATFORM ?= linux/amd64
NS       ?= shoplite

build:
> docker buildx build --platform $(PLATFORM) -t $(REGISTRY)/shoplite-api:$(TAG) --push services/api
> docker buildx build --platform $(PLATFORM) -t $(REGISTRY)/shoplite-frontend:$(TAG) --push services/frontend

deploy:
> helm upgrade --install shoplite infra/shoplite -n $(NS) --create-namespace \
>   --set image.registry=$(REGISTRY) --set image.tag=$(TAG) --set elk.enabled=false

deploy-elk:
> helm upgrade --install shoplite infra/shoplite -n $(NS) --create-namespace \
>   --set image.registry=$(REGISTRY) --set image.tag=$(TAG) --set elk.enabled=true

status:
> kubectl -n $(NS) get pods,svc,pvc,httproute

destroy:
> helm uninstall shoplite -n $(NS)
> kubectl delete pvc --all -n $(NS)
