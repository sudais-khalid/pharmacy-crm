#!/usr/bin/env bash
# End-to-end HTTP smoke test against a RUNNING, SEEDED app (default http://localhost:3000).
B=${BASE_URL:-http://localhost:3000}; fail=0
ok(){ if [ "$2" = "$3" ]; then echo "PASS  $1"; else echo "FAIL  $1 (expected $3, got $2)"; fail=1; fi; }
code(){ curl -s -o /dev/null -w "%{http_code}" "$@"; }
login(){ code -c /tmp/smoke_$1.jar -X POST $B/api/auth/login -H 'content-type: application/json' -d "{\"email\":\"$1@example.com\",\"password\":\"$2\"}"; }
js(){ python3 -c "import sys,json;d=json.load(sys.stdin);print($1)"; }

ok "Health endpoint is public" "$(code $B/api/health)" 200
ok "Health reports database up" "$(curl -s $B/api/health | js "d['checks']['database']['ok']")" True
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
# idempotent retry: same Idempotency-Key twice sells once and replays the first response
IKEY="smoke-retry-$(date +%s)"
IBODY="{\"items\":[{\"medicineId\":\"$NID\",\"quantity\":1}],\"paymentMethod\":\"CASH\"}"
R1=$(curl -s -b /tmp/smoke_cashier.jar -X POST $B/api/sales -H 'content-type: application/json' -H "Idempotency-Key: $IKEY" -d "$IBODY")
R2H=$(curl -s -D - -o /tmp/smoke_r2.json -b /tmp/smoke_cashier.jar -X POST $B/api/sales -H 'content-type: application/json' -H "Idempotency-Key: $IKEY" -d "$IBODY")
ok "Idempotent retry returns the same invoice" "$(js "d['invoiceNo']" < /tmp/smoke_r2.json)" "$(echo "$R1" | js "d['invoiceNo']")"
ok "Idempotent retry is marked as replayed" "$(echo "$R2H" | grep -ci '^idempotent-replayed: true')" 1
ok "Idempotent retry sold only once" "$(curl -s -b /tmp/smoke_cashier.jar "$B/api/pos/search?q=$BC" | js "d[0]['stock']")" 9
ok "Idempotency key reused with a different body is rejected" "$(code -b /tmp/smoke_cashier.jar -X POST $B/api/sales -H 'content-type: application/json' -H "Idempotency-Key: $IKEY" -d "{\"items\":[{\"medicineId\":\"$NID\",\"quantity\":2}],\"paymentMethod\":\"CASH\"}")" 422
ok "Double cancel rejected" "$(code -b /tmp/smoke_pharmacist.jar -X POST $B/api/sales/$SID/cancel -H 'content-type: application/json' -d '{"reason":"again"}')" 409
ok "Invoice loads" "$(code -b /tmp/smoke_cashier.jar $B/api/sales/$SID)" 200
ok "Archive instead of delete (has history)" "$(curl -s -b /tmp/smoke_admin.jar -X DELETE $B/api/medicines/$NID | js "d['archived']")" True
for t in sales profit purchases lowStock expired customerBalances supplierBalances; do ok "Report: $t" "$(code -b /tmp/smoke_admin.jar "$B/api/reports?type=$t&from=2020-01-01&to=2030-01-01")" 200; done
ok "Report rejects bad range" "$(code -b /tmp/smoke_admin.jar "$B/api/reports?type=sales&from=2030-01-01&to=2020-01-01")" 400
ok "Cross-site write blocked" "$(code -b /tmp/smoke_admin.jar -X POST $B/api/categories -H 'content-type: application/json' -H 'Origin: https://evil.example' -d '{"name":"x"}')" 403
ok "Same-origin write allowed" "$(code -b /tmp/smoke_admin.jar -X POST $B/api/categories -H 'content-type: application/json' -H "Origin: $B" -d "{\"name\":\"Smoke $(date +%s)\"}")" 200
for i in $(seq 1 8); do code -X POST $B/api/auth/login -H 'content-type: application/json' -d '{"email":"nobody@example.com","password":"wrong"}' >/dev/null; done
ok "Login locked after repeated failures" "$(code -X POST $B/api/auth/login -H 'content-type: application/json' -d '{"email":"nobody@example.com","password":"wrong"}')" 429
# Developer console (needs PLATFORM_OWNER_EMAIL and PLATFORM_OWNER_PASSWORD set for the server and this script)
if [ -n "$PLATFORM_OWNER_EMAIL" ] && [ -n "$PLATFORM_OWNER_PASSWORD" ]; then
  totp(){ python3 -c "import base64,hmac,hashlib,struct,sys,time;k=base64.b32decode(sys.argv[1].replace(' ','')+'='*((8-len(sys.argv[1].replace(' ',''))%8)%8));m=hmac.new(k,struct.pack('>Q',int(time.time())//30),hashlib.sha1).digest();o=m[-1]&15;print('%06d'%((struct.unpack('>I',m[o:o+4])[0]&0x7fffffff)%1000000))" "$1"; }
  ok "Console API needs a Developer session" "$(code $B/api/platform/auth/me)" 401
  ok "Staff session is not a Developer session" "$(code -b /tmp/smoke_admin.jar $B/api/platform/auth/me)" 401
  ok "Console page redirects without a Developer session" "$(code -b /tmp/smoke_admin.jar $B/platform)" 307
  ok "Developer wrong password rejected" "$(code -X POST $B/api/platform/auth/login -H 'content-type: application/json' -d "{\"email\":\"$PLATFORM_OWNER_EMAIL\",\"password\":\"wrong-password\"}")" 401
  NEXT=$(curl -s -c /tmp/smoke_dev.jar -X POST $B/api/platform/auth/login -H 'content-type: application/json' -d "{\"email\":\"$PLATFORM_OWNER_EMAIL\",\"password\":\"$PLATFORM_OWNER_PASSWORD\"}" | js "d['next']")
  ok "Developer password accepted, second factor next" "$NEXT" enrol
  ok "Console stays closed before the second factor" "$(code -b /tmp/smoke_dev.jar $B/platform)" 307
  SECRET=$(curl -s -b /tmp/smoke_dev.jar $B/api/platform/auth/enrol | js "d['secret']")
  ok "Wrong enrolment code rejected" "$(code -b /tmp/smoke_dev.jar -c /tmp/smoke_dev.jar -X POST $B/api/platform/auth/enrol -H 'content-type: application/json' -d '{"code":"000000"}')" 400
  CODES=$(curl -s -b /tmp/smoke_dev.jar -c /tmp/smoke_dev.jar -X POST $B/api/platform/auth/enrol -H 'content-type: application/json' -d "{\"code\":\"$(totp "$SECRET")\"}" | js "len(d['recoveryCodes'])")
  ok "Two-factor enrolled, recovery codes issued" "$CODES" 10
  ok "Developer session reaches the console" "$(code -b /tmp/smoke_dev.jar $B/platform)" 200
  ok "Developer session is not a staff session" "$(code -b /tmp/smoke_dev.jar $B/api/medicines)" 401
fi
for p in /dashboard /pos /medicines /inventory /customers /suppliers /purchases /purchases/new /sales /reports /users /settings; do ok "Page $p renders" "$(code -b /tmp/smoke_admin.jar $B$p)" 200; done
exit $fail
