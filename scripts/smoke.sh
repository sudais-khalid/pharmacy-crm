#!/usr/bin/env bash
# End-to-end HTTP smoke test against a RUNNING, SEEDED app (default http://localhost:3000).
B=${BASE_URL:-http://localhost:3000}; fail=0
ok(){ if [ "$2" = "$3" ]; then echo "PASS  $1"; else echo "FAIL  $1 (expected $3, got $2)"; fail=1; fi; }
code(){ curl -s -o /dev/null -w "%{http_code}" "$@"; }
login(){ code -c /tmp/smoke_$1.jar -X POST $B/api/auth/login -H 'content-type: application/json' -d "{\"pharmacy\":\"demo\",\"username\":\"$1\",\"password\":\"$2\"}"; }
js(){ python3 -c "import sys,json;d=json.load(sys.stdin);print($1)"; }

ok "Health endpoint is public" "$(code $B/api/health)" 200
ok "Health reports database up" "$(curl -s $B/api/health | js "d['checks']['database']['ok']")" True
ok "API requires login" "$(code $B/api/medicines)" 401
ok "Page redirects to login" "$(code $B/dashboard)" 307
ok "Wrong password rejected" "$(code -X POST $B/api/auth/login -H 'content-type: application/json' -d '{"pharmacy":"demo","username":"admin","password":"nope"}')" 401
ok "Unknown pharmacy rejected like a wrong password" "$(code -X POST $B/api/auth/login -H 'content-type: application/json' -d '{"pharmacy":"no-such-place","username":"admin","password":"Admin@12345"}')" 401
ok "Sign-in with email instead of username" "$(code -X POST $B/api/auth/login -H 'content-type: application/json' -d '{"pharmacy":"demo","username":"admin@example.com","password":"Admin@12345"}')" 200
ok "Pharmacy sign-in page shows the pharmacy" "$(curl -s $B/api/auth/pharmacy/demo | js "d['name']")" "Demo Pharmacy"
ok "Unknown pharmacy sign-in page is 404" "$(code $B/p/no-such-place/login)" 404
ok "Pharmacy sign-in page renders" "$(code $B/p/demo/login)" 200
ok "Invalid body rejected (validation)" "$(code -X POST $B/api/auth/login -H 'content-type: application/json' -d '{"username":"x"}')" 400
ok "Admin login" "$(login admin 'Admin@12345')" 200
ok "Pharmacist login" "$(login pharmacist 'Pharmacist@12345')" 200
ok "Cashier login" "$(login cashier 'Cashier@12345')" 200
ok "Cashier cannot list users" "$(code -b /tmp/smoke_cashier.jar $B/api/users)" 403
ok "Cashier cannot view reports" "$(code -b /tmp/smoke_cashier.jar $B/api/reports)" 403
ok "Cashier cannot view purchases" "$(code -b /tmp/smoke_cashier.jar $B/api/purchases)" 403
ok "Pharmacist cannot list users" "$(code -b /tmp/smoke_pharmacist.jar $B/api/users)" 403
ok "Admin can list users" "$(code -b /tmp/smoke_admin.jar $B/api/users)" 200
ok "Dashboard loads" "$(code -b /tmp/smoke_admin.jar $B/api/dashboard)" 200
ok "Cashier dashboard hides profit" "$(curl -s -b /tmp/smoke_cashier.jar $B/api/dashboard | js "d['today'].get('profit')")" None
# a cashier's responses never carry cost prices or profit (stripped for roles without cost.view)
SALE_ID=$(curl -s -b /tmp/smoke_admin.jar "$B/api/sales" | js "d['items'][0]['id']")
for p in /api/medicines /api/inventory/batches /api/dashboard "/api/pos/search?q=pa" /api/sales "/api/sales/$SALE_ID"; do
  ok "Cashier gets no cost or profit fields from $p" "$(curl -s -b /tmp/smoke_cashier.jar "$B$p" | grep -cE '"(purchasePrice|costPrice|profit|cogs|costValue|stockValueCost)"')" 0
done
ok "Pharmacist sees cost prices" "$(curl -s -b /tmp/smoke_pharmacist.jar "$B/api/sales/$SALE_ID" | grep -c '"costPrice"')" 1
ok "Cashier cannot open the profit report" "$(code -b /tmp/smoke_cashier.jar "$B/api/reports?type=profit")" 403
ok "Cashier lands on the POS" "$(curl -s -o /dev/null -w '%{redirect_url}' -b /tmp/smoke_cashier.jar $B/home | sed 's#.*//[^/]*##')" /pos
ok "Admin lands on the dashboard" "$(curl -s -o /dev/null -w '%{redirect_url}' -b /tmp/smoke_admin.jar $B/home | sed 's#.*//[^/]*##')" /dashboard
ok "Roles list for the admin" "$(curl -s -b /tmp/smoke_admin.jar $B/api/roles | js "[r['name'] for r in d['roles']][:3]")" "['Pharmacy Admin', 'Pharmacist', 'Cashier']"
ok "Cashier cannot list roles" "$(code -b /tmp/smoke_cashier.jar $B/api/roles)" 403

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
for i in $(seq 1 8); do code -X POST $B/api/auth/login -H 'content-type: application/json' -d '{"pharmacy":"demo","username":"nobody","password":"wrong"}' >/dev/null; done
ok "Login locked after repeated failures" "$(code -X POST $B/api/auth/login -H 'content-type: application/json' -d '{"pharmacy":"demo","username":"nobody","password":"wrong"}')" 429
# Developer console (needs PLATFORM_OWNER_EMAIL and PLATFORM_OWNER_PASSWORD set for the server and this script)
if [ -n "$PLATFORM_OWNER_EMAIL" ] && [ -n "$PLATFORM_OWNER_PASSWORD" ]; then
  # totp SECRET [STEP_OFFSET]: authenticator code for the current 30 s step plus an offset
  totp(){ python3 -c "import base64,hmac,hashlib,struct,sys,time;k=base64.b32decode(sys.argv[1].replace(' ','')+'='*((8-len(sys.argv[1].replace(' ',''))%8)%8));m=hmac.new(k,struct.pack('>Q',int(time.time())//30+int(sys.argv[2])),hashlib.sha1).digest();o=m[-1]&15;print('%06d'%((struct.unpack('>I',m[o:o+4])[0]&0x7fffffff)%1000000))" "$1" "${2:-0}"; }
  # codes are single use: wait until a new 30 s step starts
  next_step(){ S=$(python3 -c "import time;print(int(time.time())//30)"); while [ "$(python3 -c "import time;print(int(time.time())//30)")" = "$S" ]; do sleep 1; done; }
  ok "Console API needs a Developer session" "$(code $B/api/platform/auth/me)" 401
  ok "Desktop controls need a Developer session" "$(code -X POST $B/api/platform/desktop/authorize -H 'content-type: application/json' -d '{"action":"backup"}')" 401
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
  ok "Desktop controls do not exist on a server install" "$(code -b /tmp/smoke_dev.jar -X POST $B/api/platform/desktop/authorize -H 'content-type: application/json' -d '{"action":"backup"}')" 404
  ok "Desktop page renders outside the desktop app" "$(code -b /tmp/smoke_dev.jar $B/platform/desktop)" 200
  ok "Developer session is not a staff session" "$(code -b /tmp/smoke_dev.jar $B/api/medicines)" 401
  SLUG="smoke-$(date +%s)"
  NEWP=$(curl -s -b /tmp/smoke_dev.jar -X POST $B/api/platform/pharmacies -H 'content-type: application/json' -H "Origin: $B" -d "{\"pharmacy\":{\"name\":\"Smoke Pharmacy\",\"slug\":\"$SLUG\"},\"plan\":{},\"features\":[\"ocr\"],\"admin\":{\"name\":\"Smoke Admin\",\"username\":\"smokeadmin\",\"email\":\"$SLUG@example.com\"},\"credentials\":\"invite\"}")
  PID=$(echo "$NEWP" | js "d['pharmacy']['id']")
  ok "Developer creates a pharmacy with an invite" "$(echo "$NEWP" | js "d['credentials']['kind']")" invite
  ok "Duplicate URL name rejected" "$(code -b /tmp/smoke_dev.jar -X POST $B/api/platform/pharmacies -H 'content-type: application/json' -d "{\"pharmacy\":{\"name\":\"Again\",\"slug\":\"$SLUG\"},\"plan\":{},\"admin\":{\"name\":\"X Y\",\"username\":\"xy\",\"email\":\"other-$SLUG@example.com\"},\"credentials\":\"invite\"}")" 409
  ok "New pharmacy is listed" "$(curl -s -b /tmp/smoke_dev.jar "$B/api/platform/pharmacies?q=$SLUG" | js "len(d['items'])")" 1
  ok "Pharmacy detail loads" "$(code -b /tmp/smoke_dev.jar $B/api/platform/pharmacies/$PID)" 200
  ok "Unknown pharmacy is 404" "$(code -b /tmp/smoke_dev.jar $B/api/platform/pharmacies/00000000-0000-0000-0000-000000000000)" 404
  ok "Other pharmacy staff invisible to this pharmacy" "$(curl -s -b /tmp/smoke_admin.jar $B/api/users | js "str(any(u['username']=='smokeadmin' for u in d['items']))")" False
  ok "Invite link page opens" "$(code $B$(echo "$NEWP" | js "d['credentials']['path']"))" 200
  for p in /platform/pharmacies /platform/pharmacies/new /platform/pharmacies/$PID; do ok "Console page $p renders" "$(code -b /tmp/smoke_dev.jar $B$p)" 200; done
  DEMO=$(curl -s -b /tmp/smoke_dev.jar "$B/api/platform/pharmacies?q=demo" | js "d['items'][0]['id']")
  ok "Status change needs an authenticator code" "$(code -b /tmp/smoke_dev.jar -X POST $B/api/platform/pharmacies/$DEMO/status -H 'content-type: application/json' -d '{"status":"SUSPENDED","reason":"smoke test"}')" 400
  next_step
  ok "Developer suspends a pharmacy" "$(code -b /tmp/smoke_dev.jar -X POST $B/api/platform/pharmacies/$DEMO/status -H 'content-type: application/json' -d "{\"status\":\"SUSPENDED\",\"reason\":\"smoke test\",\"code\":\"$(totp "$SECRET")\"}")" 200
  ok "Suspended pharmacy: open staff session ends" "$(code -b /tmp/smoke_admin.jar $B/api/medicines)" 401
  ok "Suspended pharmacy: sign-in refused with a reason" "$(curl -s -X POST $B/api/auth/login -H 'content-type: application/json' -d '{"pharmacy":"demo","username":"admin","password":"Admin@12345"}' | js "'suspended' in d['error']")" True
  next_step
  ok "Developer reactivates the pharmacy" "$(code -b /tmp/smoke_dev.jar -X POST $B/api/platform/pharmacies/$DEMO/status -H 'content-type: application/json' -d "{\"status\":\"ACTIVE\",\"reason\":\"smoke test done\",\"code\":\"$(totp "$SECRET")\"}")" 200
  ok "Reactivated pharmacy: staff session works again" "$(code -b /tmp/smoke_admin.jar $B/api/medicines)" 200
  CASHIER_ID=$(curl -s -b /tmp/smoke_dev.jar "$B/api/platform/accounts?q=cashier" | js "[a for a in d['items'] if a['email']=='cashier@example.com'][0]['id']")
  ok "Accounts list spans pharmacies" "$(curl -s -b /tmp/smoke_dev.jar "$B/api/platform/accounts?q=smokeadmin" | js "d['items'][0]['pharmacy']['slug'][:6]")" smoke-
  RESET=$(curl -s -b /tmp/smoke_dev.jar -X POST $B/api/platform/accounts/$CASHIER_ID/reset -H 'content-type: application/json' -d '{}' | js "d['path']")
  ok "Reset link page opens" "$(code $B$RESET)" 200
  ok "Reset link is valid for the cashier" "$(curl -s $B/api/auth/token/${RESET##*/} | js "d['username']")" cashier
  ok "Developer forces a sign-out" "$(code -b /tmp/smoke_dev.jar -X POST $B/api/platform/accounts/$CASHIER_ID/logout -H 'content-type: application/json' -d '{}')" 200
  ok "Forced sign-out ends the live session" "$(code -b /tmp/smoke_cashier.jar $B/api/medicines)" 401
  ok "Accounts page renders" "$(code -b /tmp/smoke_dev.jar $B/platform/accounts)" 200
  ok "Support session needs a reason" "$(code -b /tmp/smoke_dev.jar -c /tmp/smoke_dev.jar -X POST $B/api/platform/pharmacies/$DEMO/support -H 'content-type: application/json' -d '{"reason":""}')" 400
  ok "Developer opens a pharmacy as support" "$(code -b /tmp/smoke_dev.jar -c /tmp/smoke_dev.jar -X POST $B/api/platform/pharmacies/$DEMO/support -H 'content-type: application/json' -d '{"reason":"smoke test support"}')" 200
  ok "Support session acts as the hidden support account" "$(curl -s -b /tmp/smoke_dev.jar $B/api/auth/me | js "d['user']['name']")" "Platform support"
  ok "Support session reads pharmacy data" "$(code -b /tmp/smoke_dev.jar $B/api/medicines)" 200
  ok "Support session opens pharmacy pages" "$(code -b /tmp/smoke_dev.jar $B/dashboard)" 200
  ok "Developer ends the support session" "$(curl -s -b /tmp/smoke_dev.jar -c /tmp/smoke_dev.jar -X POST $B/api/platform/support/end -H 'content-type: application/json' -d '{}' | js "d['redirect'].startswith('/platform/pharmacies/')")" True
  ok "Ended support session has no pharmacy access" "$(code -b /tmp/smoke_dev.jar $B/api/medicines)" 401
  ok "Developer switches a feature off" "$(curl -s -b /tmp/smoke_dev.jar -X POST $B/api/platform/pharmacies/$PID/features -H 'content-type: application/json' -d '{"key":"ocr","enabled":false}' | js "d['enabled']")" False
  ok "Developer updates plan limits" "$(curl -s -b /tmp/smoke_dev.jar -X PUT $B/api/platform/pharmacies/$PID/plan -H 'content-type: application/json' -d '{"plan":"PREMIUM","maxUsers":4,"ocrMonthlyLimit":50}' | js "d['maxUsers']")" 4
fi
for p in /dashboard /pos /medicines /inventory /customers /suppliers /purchases /purchases/new /sales /reports /users /settings; do ok "Page $p renders" "$(code -b /tmp/smoke_admin.jar $B$p)" 200; done
exit $fail
