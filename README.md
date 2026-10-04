# ShopLite Tasks

Browser -> Envoy Gateway (NodePort 32136) -> HTTPRoute
  /api -> api (Node/Express) -> Postgres (+ Redis cache)
  /    -> frontend (nginx)
Optional ELK: Filebeat (DaemonSet) -> Elasticsearch -> Kibana

## 1. Build & push images (from your laptop)
    docker login -u rwxatharv
    make build REGISTRY=rwxatharv TAG=v1

## 2. Deploy (run where kubectl works)
    make deploy        # app only  (elk.enabled=false)
    make deploy-elk    # app + ELK (elk.enabled=true)
Or directly:
    helm upgrade --install shoplite infra/shoplite -n shoplite --create-namespace \
      --set image.tag=v1 --set elk.enabled=true --set db.password=MySecret123

Toggle ELK any time by re-running helm upgrade with elk.enabled=true/false.

## 3. Open
    App    http://shoplite.3.108.88.140.nip.io:32136
    Kibana http://kibana.3.108.88.140.nip.io:32136   (ELK on; Discover -> "ShopLite Logs")

## Useful
    make status
    kubectl -n shoplite logs -f deploy/api
    kubectl -n shoplite get pods -w
    make destroy

## Memory note
Your 2 workers have 4 GB each. ELK needs ~2.5 GB. If pods stay Pending
(kubectl -n shoplite describe pod <name>), scale down the old ShopMesh app:
    kubectl -n shopmesh scale deploy --all --replicas=0
