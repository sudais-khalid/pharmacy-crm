#!/usr/bin/env bash
# End-to-end HTTP smoke test against a RUNNING, SEEDED app (default http://localhost:3000).
B=${BASE_URL:-http://localhost:3000}; fail=0
ok(){ if [ "$2" = "$3" ]; then echo "PASS  $1"; else echo "FAIL  $1 (expected $3, got $2)"; fail=1; fi; }
code(){ curl -s -o /dev/null -w "%{http_code}" "$@"; }
login(){ code -c /tmp/smoke_$1.jar -X POST $B/api/auth/login -H 'content-type: application/json' -d "{\"email\":\"$1@example.com\",\"password\":\"$2\"}"; }
js(){ python3 -c "import sys,json;d=json.load(sys.stdin);print($1)"; }

ok "API requires login" "$(code $B/api/medicines)" 401
ok "Page redirects to login" "$(code $B/dashboard)" 307
ok "Wrong password rejected" "$(code -X POST $B/api/auth/login -H 'content-type: application/json' -d '{"email":"admin@example.com","password":"nope"}')" 401
ok "Invalid body rejected (validation)" "$(code -X POST $B/api/auth/login -H 'content-type: application/json' -d '{"email":"x"}')" 400
ok "Admin login" "$(login admin 'Admin@12345')" 200
ok "Pharmacist login" "$(login pharmacist 'Pharmacist@12345')" 200
ok "Cashier login" "$(login cashier 'Cashier@12345')" 200
ok "Cashier cannot list users" "$(code -b /tmp/smoke_cashier.jar $B/api/users)" 403
ok "Cashier cannot view reports" "$(code -b /tmp/smoke_cashier.jar $B/api/reports)" 403
ok "Cashier cannot view purchases" "$(code -b /tmp/smoke_cashier.jar $B/api/purchases)" 403
ok "Pharmacist cannot list users" "$(code -b /tmp/smoke_pharmacist.jar $B/api/users)" 403
ok "Admin can list users" "$(code -b /tmp/smoke_admin.jar $B/api/users)" 200
ok "Dashboard loads" "$(code -b /tmp/smoke_admin.jar $B/api/dashboard)" 200
ok "Cashier dashboard hides profit" "$(curl -s -b /tmp/smoke_cashier.jar $B/api/dashboard | js "d['today']['profit']")" None

MID=$(curl -s -b /tmp/smoke_admin.jar "$B/api/medicines?q=Panadol" | js "d['items'][0]['id']")
ok "Cashier cannot delete medicine" "$(code -b /tmp/smoke_cashier.jar -X DELETE $B/api/medicines/$MID)" 403
ok "Cashier cannot create medicine" "$(code -b /tmp/smoke_cashier.jar -X POST $B/api/medicines -H 'content-type: application/json' -d '{"name":"x"}')" 403
ok "Medicine validation (empty name)" "$(code -b /tmp/smoke_admin.jar -X POST $B/api/medicines -H 'content-type: application/json' -d '{"name":""}')" 400

# create medicine with opening stock, search it by barcode, sell via FEFO, check stock
BC="TEST$(date +%s)"
NEW=$(curl -s -b /tmp/smoke_pharmacist.jar -X POST $B/api/medicines -H 'content-type: application/json' -d "{\"name\":\"Smoke Test Syrup\",\"barcode\":\"$BC\",\"salePrice\":100,\"purchasePrice\":60,\"opening\":{\"batchNumber\":\"S1\",\"expiryDate\":\"2030-01-01\",\"quantity\":10}}")
NID=$(echo "$NEW" | js "d['id']")
ok "Duplicate barcode rejected" "$(code -b /tmp/smoke_pharmacist.jar -X POST $B/api/medicines -H 'content-type: application/json' -d "{\"name\":\"Dup\",\"barcode\":\"$BC\"}")" 409
ok "POS barcode search finds item first" "$(curl -s -b /tmp/smoke_cashier.jar "$B/api/pos/search?q=$BC" | js "d[0]['name']+str(d[0]['stock'])")" "Smoke Test Syrup10"
SALE=$(curl -s -b /tmp/smoke_cashier.jar -X POST $B/api/sales -H 'content-type: application/json' -d "{\"items\":[{\"medicineId\":\"$NID\",\"quantity\":4}],\"discountType\":\"PERCENT\",\"discountValue\":10,\"paymentMethod\":\"CASH\"}")
ok "Sale total (4x100 less 10%)" "$(echo "$SALE" | js "float(d['total'])")" 360.0
ok "Stock reduced after sale" "$(curl -s -b /tmp/smoke_cashier.jar "$B/api/pos/search?q=$BC" | js "d[0]['stock']")" 6
ok "Oversell rejected (insufficient stock)" "$(code -b /tmp/smoke_cashier.jar -X POST $B/api/sales -H 'content-type: application/json' -d "{\"items\":[{\"medicineId\":\"$NID\",\"quantity\":7}],\"paymentMethod\":\"CASH\"}")" 409
ok "Stock unchanged after failed sale" "$(curl -s -b /tmp/smoke_cashier.jar "$B/api/pos/search?q=$BC" | js "d[0]['stock']")" 6
ok "Credit sale without customer rejected" "$(code -b /tmp/smoke_cashier.jar -X POST $B/api/sales -H 'content-type: application/json' -d "{\"items\":[{\"medicineId\":\"$NID\",\"quantity\":1}],\"paymentMethod\":\"CREDIT\"}")" 400
SID=$(echo "$SALE" | js "d['id']")
ok "Cashier cannot cancel sale" "$(code -b /tmp/smoke_cashier.jar -X POST $B/api/sales/$SID/cancel -H 'content-type: application/json' -d '{"reason":"test"}')" 403
ok "Pharmacist cancels sale" "$(code -b /tmp/smoke_pharmacist.jar -X POST $B/api/sales/$SID/cancel -H 'content-type: application/json' -d '{"reason":"smoke test"}')" 200
ok "Stock restored after cancel" "$(curl -s -b /tmp/smoke_cashier.jar "$B/api/pos/search?q=$BC" | js "d[0]['stock']")" 10
ok "Double cancel rejected" "$(code -b /tmp/smoke_pharmacist.jar -X POST $B/api/sales/$SID/cancel -H 'content-type: application/json' -d '{"reason":"again"}')" 409
ok "Invoice loads" "$(code -b /tmp/smoke_cashier.jar $B/api/sales/$SID)" 200
ok "Archive instead of delete (has history)" "$(curl -s -b /tmp/smoke_admin.jar -X DELETE $B/api/medicines/$NID | js "d['archived']")" True
for t in sales profit purchases lowStock expired customerBalances supplierBalances; do ok "Report: $t" "$(code -b /tmp/smoke_admin.jar "$B/api/reports?type=$t&from=2020-01-01&to=2030-01-01")" 200; done
ok "Report rejects bad range" "$(code -b /tmp/smoke_admin.jar "$B/api/reports?type=sales&from=2030-01-01&to=2020-01-01")" 400
for p in /dashboard /pos /medicines /inventory /customers /suppliers /purchases /purchases/new /sales /reports /users /settings; do ok "Page $p renders" "$(code -b /tmp/smoke_admin.jar $B$p)" 200; done
exit $fail
