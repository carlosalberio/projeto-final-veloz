(() => {
  const keys = {
    users: 'veloz.users',
    session: 'veloz.session',
    rides: 'veloz.rides',
    expenses: 'veloz.expenses',
    goals: 'veloz.goals',
    availability: 'veloz.availability',
    notifications: 'veloz.notifications',
    gps: 'veloz.gps',
  };
  const defaultGoals = ['diaria', 'semanal', 'mensal'].map((period) => ({
    period,
    target_cents: null,
    target_rides: null,
  }));
  const fail = (status, message) => {
    const error = new Error(message);
    error.status = status;
    throw error;
  };
  const read = (key, fallback) => {
    let value;
    try {
      value = localStorage.getItem(key);
    } catch {
      fail(503, 'O armazenamento local está bloqueado neste navegador.');
    }
    if (value === null) return fallback;
    try {
      return JSON.parse(value);
    } catch {
      fail(503, 'Os dados salvos localmente estão inválidos. Exporte ou limpe os dados do site antes de continuar.');
    }
  };
  const write = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      fail(507, 'Não foi possível salvar. O armazenamento local pode estar cheio ou indisponível.');
    }
    return value;
  };
  const id = () => window.crypto?.randomUUID?.()
    || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const users = () => read(keys.users, []);
  const saveUsers = (value) => write(keys.users, value);
  const rides = () => read(keys.rides, []);
  const saveRides = (value) => write(keys.rides, value);
  const currentUser = () => {
    const session = read(keys.session, null);
    return session
      ? users().find((user) => user.email === session.email && user.accountType === session.accountType) || null
      : null;
  };
  const requireUser = (accountType) => {
    const user = currentUser();
    if (!user) fail(401, 'Entre na sua conta para continuar.');
    if (accountType && user.accountType !== accountType) fail(403, 'Esta operação não está disponível para esse tipo de conta.');
    return user;
  };
  const publicUser = (user) => ({
    name: user.name,
    email: user.email,
    accountType: user.accountType,
    phone: user.phone,
  });
  const parseBody = (body) => {
    if (!body) return {};
    if (typeof body !== 'string') return body;
    try {
      return JSON.parse(body);
    } catch {
      fail(400, 'Os dados enviados estão inválidos.');
    }
  };
  const hashPassword = async (password, salt) => {
    if (!window.crypto?.subtle) {
      fail(503, 'Este navegador não oferece armazenamento seguro de senha. Abra o site em localhost ou HTTPS.');
    }
    const key = await window.crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveBits'],
    );
    const bits = await window.crypto.subtle.deriveBits({
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations: 120000,
    }, key, 256);
    return Array.from(new Uint8Array(bits), (byte) => byte.toString(16).padStart(2, '0')).join('');
  };
  const createAccount = async (payload) => {
    const email = String(payload.email || '').trim().toLowerCase();
    const name = String(payload.name || '').trim();
    const phone = String(payload.phone || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(422, 'Informe um e-mail válido.');
    if (name.length < 2) fail(422, 'Informe seu nome completo.');
    if (phone.replace(/\D/g, '').length < 8) fail(422, 'Informe um celular válido.');
    if (!Number.isInteger(Number(payload.age)) || Number(payload.age) < 18 || Number(payload.age) > 100) {
      fail(422, 'É necessário ter entre 18 e 100 anos.');
    }
    if (String(payload.password || '').length < 8 || String(payload.password).length > 128) {
      fail(422, 'A senha deve ter entre 8 e 128 caracteres.');
    }
    if (!['cliente', 'mototaxista'].includes(payload.accountType)) fail(422, 'Tipo de conta inválido.');
    if (payload.accountType === 'mototaxista') {
      const cpf = String(payload.cpf || '').replace(/\D/g, '');
      const cnh = String(payload.cnh || '').replace(/\D/g, '');
      const category = String(payload.cnhCategory || '').trim().toUpperCase();
      const expiry = new Date(`${payload.cnhExpiry || ''}T00:00:00`);
      const plate = String(payload.plate || '').trim().toUpperCase();
      if (cpf.length !== 11) fail(422, 'Informe um CPF com 11 dígitos.');
      if (cnh.length !== 11) fail(422, 'Informe uma CNH com 11 dígitos.');
      if (!['A', 'B', 'A/B'].includes(category)) fail(422, 'Selecione uma categoria de CNH válida.');
      if (Number.isNaN(expiry.getTime())) fail(422, 'Informe a validade da CNH.');
      if (expiry < new Date(new Date().toDateString())) fail(422, 'A CNH informada está vencida.');
      if (!String(payload.motorcycle || '').trim()) fail(422, 'Informe o modelo da moto.');
      if (!/^(?:[A-Z]{3}\d[A-Z0-9]\d{2}|[A-Z]{3}\d{4})$/.test(plate)) {
        fail(422, 'Informe uma placa válida.');
      }
    }
    if (users().some((user) => user.email === email && user.accountType === payload.accountType)) {
      fail(409, 'Já existe um cadastro com este e-mail para esse tipo de conta.');
    }
    const salt = window.crypto.getRandomValues(new Uint8Array(16));
    const saltHex = Array.from(salt, (byte) => byte.toString(16).padStart(2, '0')).join('');
    const passwordHash = await hashPassword(String(payload.password || ''), salt);
    const account = {
      id: id(),
      accountType: payload.accountType,
      name,
      email,
      phone,
      age: Number(payload.age),
      passwordSalt: saltHex,
      passwordHash,
      motorcycle: String(payload.motorcycle || '').trim(),
      plate: String(payload.plate || '').trim().toUpperCase(),
      photo: null,
    };
    saveUsers([...users(), account]);
    return publicUser(account);
  };
  const signIn = async (payload) => {
    const email = String(payload.email || '').trim().toLowerCase();
    const account = users().find((user) => (
      user.email === email && user.accountType === payload.accountType
    ));
    if (!account) fail(401, 'E-mail ou senha inválidos.');
    const salt = Uint8Array.from(account.passwordSalt.match(/.{2}/g) || [], (part) => parseInt(part, 16));
    const candidate = await hashPassword(String(payload.password || ''), salt);
    let difference = candidate.length ^ account.passwordHash.length;
    for (let index = 0; index < Math.max(candidate.length, account.passwordHash.length); index += 1) {
      difference |= (candidate.charCodeAt(index) || 0) ^ (account.passwordHash.charCodeAt(index) || 0);
    }
    if (difference !== 0) fail(401, 'E-mail ou senha inválidos.');
    write(keys.session, { email: account.email, accountType: account.accountType });
    return { user: publicUser(account) };
  };
  const ownedRides = (user) => rides().filter((ride) => (
    user.accountType === 'cliente'
      ? ride.customer_email === user.email
      : ride.driver_email === user.email
  ));
  const distanceBetween = (left, right) => {
    const radians = (value) => (value * Math.PI) / 180;
    const latitude = radians(right.latitude - left.latitude);
    const longitude = radians(right.longitude - left.longitude);
    const value = Math.sin(latitude / 2) ** 2
      + Math.cos(radians(left.latitude)) * Math.cos(radians(right.latitude))
      * Math.sin(longitude / 2) ** 2;
    return Math.round(6371000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value)));
  };
  const dateRange = (period) => {
    const end = new Date();
    const start = new Date(end);
    const days = period === 'hoje' ? 1 : period === '30dias' ? 30 : period === '7dias' ? 7 : 7;
    start.setDate(start.getDate() - days + 1);
    start.setHours(0, 0, 0, 0);
    return { start, end, days };
  };
  const dateInRange = (value, range) => {
    const date = new Date(value);
    return !Number.isNaN(date.getTime()) && date >= range.start && date <= range.end;
  };
  const driverRides = (user) => ownedRides(user);
  const dashboard = (user, period) => {
    const range = dateRange(period);
    const ridesInPeriod = driverRides(user).filter((ride) => dateInRange(ride.created_at, range));
    const expenses = read(keys.expenses, []).filter((expense) => (
      expense.driver_email === user.email && dateInRange(expense.spent_on, range)
    ));
    const completed = ridesInPeriod.filter((ride) => ride.status === 'concluida');
    const confirmed = completed.filter((ride) => ride.payment_status === 'confirmado');
    const pending = completed.filter((ride) => ride.payment_status !== 'confirmado');
    const confirmedEarnings = confirmed.reduce((sum, ride) => sum + ride.amount_cents, 0);
    const pendingPayments = pending.reduce((sum, ride) => sum + ride.amount_cents, 0);
    const expensesTotal = expenses.reduce((sum, expense) => sum + expense.amount_cents, 0);
    const chart = Array.from({ length: range.days }, (_, index) => {
      const date = new Date(range.start);
      date.setDate(date.getDate() + index);
      const key = date.toISOString().slice(0, 10);
      return {
        date: key,
        paid_cents: confirmed.filter((ride) => ride.completed_at?.slice(0, 10) === key)
          .reduce((sum, ride) => sum + ride.amount_cents, 0),
        expenses_cents: expenses.filter((expense) => expense.spent_on === key)
          .reduce((sum, expense) => sum + expense.amount_cents, 0),
      };
    });
    const total = ridesInPeriod.length;
    return {
      metrics: {
        confirmed_earnings_cents: confirmedEarnings,
        pending_payments_cents: pendingPayments,
        completed_rides: completed.length,
        requested_rides: total,
        gps_distance_m: ridesInPeriod.reduce((sum, ride) => sum + (ride.gps_distance_m || 0), 0),
        expenses_cents: expensesTotal,
        net_cents: confirmedEarnings - expensesTotal,
        online_seconds: 0,
        acceptance_rate: total ? completed.length / total : null,
        cancellation_rate: total ? ridesInPeriod.filter((ride) => ride.status === 'cancelada').length / total : null,
        cancelled_rides: ridesInPeriod.filter((ride) => ride.status === 'cancelada').length,
        average_ticket_cents: completed.length
          ? Math.round(completed.reduce((sum, ride) => sum + ride.amount_cents, 0) / completed.length)
          : null,
        earnings_per_online_hour_cents: null,
        average_duration_seconds: null,
        average_rating: null,
        rating_count: 0,
        estimated_distance_km: null,
      },
      chart,
    };
  };
  const saveRide = (ride) => {
    const list = rides();
    const index = list.findIndex((item) => item.id === ride.id);
    if (index < 0) list.push(ride);
    else list[index] = ride;
    saveRides(list);
    return ride;
  };
  const newRide = (payload, customer) => {
    const previous = rides().find((ride) => (
      ride.customer_email === customer.email && ride.idempotency_key === payload.idempotency_key
    ));
    if (previous) return previous;
    const created = new Date().toISOString();
    const ride = {
      id: id(),
      code: String(Math.floor(100000 + Math.random() * 900000)),
      service_type: payload.service_type === 'pedido' ? 'pedido' : 'passageiro',
      customer_email: customer.email,
      driver_email: null,
      passenger_name: payload.passenger_name || customer.name,
      passenger_phone: payload.passenger_phone || customer.phone,
      pickup: String(payload.pickup || ''),
      destination: String(payload.destination || ''),
      pickup_lat: Number(payload.pickup_lat),
      pickup_lng: Number(payload.pickup_lng),
      destination_lat: Number(payload.destination_lat),
      destination_lng: Number(payload.destination_lng),
      scheduled_at: payload.scheduled_at || null,
      created_at: created,
      accepted_at: null,
      started_at: null,
      completed_at: null,
      canceled_at: null,
      amount_cents: 700,
      payment_method: 'Dinheiro',
      payment_status: 'pendente',
      status: 'solicitada',
      gps_distance_m: 0,
      duration_seconds: null,
      idempotency_key: payload.idempotency_key,
      rejected_by: [],
    };
    return saveRide(ride);
  };
  const parseUrl = (path) => {
    const [pathname, query = ''] = path.split('?');
    return { pathname: pathname.replace(/\/+$/, '') || '/', query: new URLSearchParams(query) };
  };
  const filteredRides = (user, query) => {
    let list = driverRides(user);
    const status = query.get('status');
    const from = query.get('from');
    const to = query.get('to');
    if (status) list = list.filter((ride) => ride.status === status);
    if (from) list = list.filter((ride) => ride.created_at.slice(0, 10) >= from);
    if (to) list = list.filter((ride) => ride.created_at.slice(0, 10) <= to);
    return list.sort((left, right) => right.created_at.localeCompare(left.created_at));
  };
  const request = async (path, options = {}) => {
    const method = (options.method || 'GET').toUpperCase();
    const { pathname, query } = parseUrl(path);
    const body = parseBody(options.body);

    if (pathname === '/api/register' && method === 'POST') {
      return createAccount(body);
    }
    if (pathname === '/api/login' && method === 'POST') return signIn(body);
    if (pathname === '/api/me' && method === 'GET') {
      const user = currentUser();
      return { user: user ? publicUser(user) : null };
    }
    if (pathname === '/api/logout' && method === 'POST') {
      try {
        localStorage.removeItem(keys.session);
      } catch {
        fail(503, 'Não foi possível encerrar a sessão local.');
      }
      return { ok: true };
    }
    if (pathname === '/api/customer/profile' && method === 'PUT') {
      const user = requireUser('cliente');
      const updated = { ...user, ...body };
      saveUsers(users().map((item) => item.id === user.id ? updated : item));
      return publicUser(updated);
    }
    if (pathname === '/api/rides/mine' && method === 'GET') {
      return { rides: ownedRides(requireUser('cliente')).sort((a, b) => b.created_at.localeCompare(a.created_at)) };
    }
    if (pathname === '/api/rides' && method === 'POST') {
      return newRide(body, requireUser('cliente'));
    }
    const customerCancel = pathname.match(/^\/api\/rides\/([^/]+)\/cancel$/);
    if (customerCancel && method === 'POST') {
      const user = requireUser('cliente');
      const ride = rides().find((item) => item.id === customerCancel[1] && item.customer_email === user.email);
      if (!ride) fail(404, 'A solicitação não foi encontrada.');
      if (ride.status !== 'solicitada') fail(409, 'Esta solicitação não pode mais ser cancelada.');
      ride.status = 'cancelada';
      ride.canceled_at = new Date().toISOString();
      return saveRide(ride);
    }
    if (pathname === '/api/driver/profile' && method === 'GET') {
      const user = requireUser('mototaxista');
      return {
        name: user.name,
        email: user.email,
        phone: user.phone,
        motorcycle: user.motorcycle || '',
        plate: user.plate || '',
        photo_url: user.photo || null,
      };
    }
    if (pathname === '/api/driver/profile' && method === 'PUT') {
      const user = requireUser('mototaxista');
      const updated = { ...user, ...body };
      saveUsers(users().map((item) => item.id === user.id ? updated : item));
      return { name: updated.name, email: updated.email, phone: updated.phone };
    }
    if (pathname === '/api/driver/profile/photo' && method === 'POST') {
      const user = requireUser('mototaxista');
      if (!(options.body instanceof Blob)) fail(400, 'Selecione uma imagem válida.');
      const photo = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Não foi possível ler a imagem selecionada.'));
        reader.readAsDataURL(options.body);
      });
      const updated = { ...user, photo };
      saveUsers(users().map((item) => item.id === user.id ? updated : item));
      return { ok: true };
    }
    if (pathname === '/api/driver/profile/photo' && method === 'DELETE') {
      const user = requireUser('mototaxista');
      saveUsers(users().map((item) => item.id === user.id ? { ...item, photo: null } : item));
      return { ok: true };
    }
    if (pathname === '/api/driver/availability' && method === 'GET') {
      const user = requireUser('mototaxista');
      return { online: Boolean(read(keys.availability, {})[user.email]) };
    }
    if (pathname === '/api/driver/availability' && method === 'PUT') {
      const user = requireUser('mototaxista');
      const availability = read(keys.availability, {});
      availability[user.email] = Boolean(body.online);
      write(keys.availability, availability);
      return { online: availability[user.email] };
    }
    if (pathname === '/api/driver/availability/heartbeat' && method === 'POST') {
      const user = requireUser('mototaxista');
      return { online: Boolean(read(keys.availability, {})[user.email]) };
    }
    if (pathname === '/api/driver/dashboard' && method === 'GET') {
      return dashboard(requireUser('mototaxista'), query.get('period'));
    }
    if (pathname === '/api/driver/goals' && method === 'GET') {
      const user = requireUser('mototaxista');
      const goals = read(keys.goals, {});
      return { goals: defaultGoals.map((goal) => goals[`${user.email}:${goal.period}`] || goal) };
    }
    if (pathname === '/api/driver/goals' && method === 'PUT') {
      const user = requireUser('mototaxista');
      if (!['diaria', 'semanal', 'mensal'].includes(body.period)) fail(422, 'Período da meta inválido.');
      const goals = read(keys.goals, {});
      goals[`${user.email}:${body.period}`] = {
        period: body.period,
        target_cents: body.target_cents,
        target_rides: body.target_rides,
      };
      write(keys.goals, goals);
      return { ok: true };
    }
    if (pathname === '/api/driver/rides/available' && method === 'GET') {
      const user = requireUser('mototaxista');
      return {
        rides: rides()
          .filter((ride) => ride.status === 'solicitada' && !ride.driver_email && !(ride.rejected_by || []).includes(user.email))
          .sort((a, b) => b.created_at.localeCompare(a.created_at)),
      };
    }
    if (pathname === '/api/driver/rides' && method === 'GET') {
      const user = requireUser('mototaxista');
      const list = filteredRides(user, query);
      const page = Math.max(1, Number(query.get('page')) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(query.get('page_size')) || 20));
      return { rides: list.slice((page - 1) * pageSize, page * pageSize), total: list.length };
    }
    if (pathname === '/api/driver/deliveries' && method === 'GET') {
      const user = requireUser('mototaxista');
      return {
        deliveries: driverRides(user).filter((ride) => ride.service_type === 'pedido').map((ride) => ({
          ...ride,
          delivered_at: ride.completed_at,
          category: 'Pedido',
        })),
      };
    }
    const rideMatch = pathname.match(/^\/api\/driver\/rides\/([^/]+)(?:\/(accept|decline|status|gps))?$/);
    if (rideMatch) {
      const user = requireUser('mototaxista');
      const ride = rides().find((item) => item.id === rideMatch[1]);
      const action = rideMatch[2];
      if (!ride) fail(404, 'Corrida não encontrada.');
      if (action === 'gps' && method === 'GET') {
        const points = read(keys.gps, {})[ride.id] || [];
        return { points, distance_m: ride.gps_distance_m || 0 };
      }
      if (!action && method === 'GET') {
        if (ride.driver_email !== user.email) fail(404, 'Corrida não encontrada no seu painel.');
        return ride;
      }
      if (action === 'accept' && method === 'POST') {
        if (ride.status !== 'solicitada' || ride.driver_email) fail(409, 'Esta solicitação já foi atendida.');
        ride.driver_email = user.email;
        ride.status = 'aceita';
        ride.accepted_at = new Date().toISOString();
        return saveRide(ride);
      }
      if (action === 'decline' && method === 'POST') {
        ride.rejected_by = [...new Set([...(ride.rejected_by || []), user.email])];
        return { ok: true };
      }
      if (action === 'status' && method === 'PATCH') {
        if (ride.driver_email !== user.email) fail(403, 'Esta corrida não está vinculada à sua conta.');
        const allowed = {
          aceita: ['em_andamento', 'cancelada'],
          em_andamento: ['concluida', 'cancelada'],
        };
        if (!allowed[ride.status]?.includes(body.status)) fail(409, 'Transição de status inválida.');
        ride.status = body.status;
        if (body.status === 'em_andamento') ride.started_at = new Date().toISOString();
        if (body.status === 'concluida') {
          ride.completed_at = new Date().toISOString();
          ride.duration_seconds = ride.started_at
            ? Math.max(0, Math.floor((Date.now() - new Date(ride.started_at).getTime()) / 1000))
            : null;
        }
        if (body.status === 'cancelada') ride.canceled_at = new Date().toISOString();
        return saveRide(ride);
      }
      if (action === 'gps' && method === 'POST') {
        if (ride.driver_email !== user.email || ride.status !== 'em_andamento') {
          fail(409, 'O GPS só pode ser registrado durante uma corrida em andamento.');
        }
        const latitude = Number(body.latitude);
        const longitude = Number(body.longitude);
        const accuracy = Number(body.accuracy_m);
        if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
          || !Number.isFinite(longitude) || longitude < -180 || longitude > 180
          || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > 100) {
          fail(422, 'A localização recebida é inválida ou imprecisa.');
        }
        const gps = read(keys.gps, {});
        const points = gps[ride.id] || [];
        const point = {
          latitude,
          longitude,
          accuracy_m: accuracy,
          recorded_at: body.recorded_at || new Date().toISOString(),
        };
        if (points.length) ride.gps_distance_m = (ride.gps_distance_m || 0) + distanceBetween(points[points.length - 1], point);
        gps[ride.id] = [...points, point];
        write(keys.gps, gps);
        saveRide(ride);
        return { distance_m: ride.gps_distance_m };
      }
    }
    if (pathname === '/api/driver/expenses' && method === 'GET') {
      const user = requireUser('mototaxista');
      return { expenses: read(keys.expenses, []).filter((item) => item.driver_email === user.email) };
    }
    if (pathname === '/api/driver/expenses' && method === 'POST') {
      const user = requireUser('mototaxista');
      if (!body.description?.trim() || !Number.isInteger(body.amount_cents) || body.amount_cents <= 0) {
        fail(422, 'Informe uma descrição e um valor válido.');
      }
      const expense = { ...body, id: id(), driver_email: user.email, created_at: new Date().toISOString() };
      write(keys.expenses, [...read(keys.expenses, []), expense]);
      return expense;
    }
    const expenseMatch = pathname.match(/^\/api\/driver\/expenses\/([^/]+)$/);
    if (expenseMatch) {
      const user = requireUser('mototaxista');
      const list = read(keys.expenses, []);
      const index = list.findIndex((item) => item.id === expenseMatch[1] && item.driver_email === user.email);
      if (index < 0) fail(404, 'Despesa não encontrada.');
      if (method === 'DELETE') {
        write(keys.expenses, list.filter((_, itemIndex) => itemIndex !== index));
        return { ok: true };
      }
      if (method === 'PUT') {
        list[index] = { ...list[index], ...body, updated_at: new Date().toISOString() };
        write(keys.expenses, list);
        return list[index];
      }
    }
    if (pathname === '/api/driver/reviews' && method === 'GET') {
      requireUser('mototaxista');
      return { average: null, total: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, reviews: [] };
    }
    if (pathname === '/api/driver/notifications' && method === 'GET') {
      const user = requireUser('mototaxista');
      const notifications = read(keys.notifications, []).filter((item) => item.driver_email === user.email);
      return { notifications, unread: notifications.filter((item) => !item.read_at).length };
    }
    if (pathname === '/api/driver/notifications/read-all' && method === 'PATCH') {
      const user = requireUser('mototaxista');
      write(keys.notifications, read(keys.notifications, []).map((item) => (
        item.driver_email === user.email && !item.read_at ? { ...item, read_at: new Date().toISOString() } : item
      )));
      return { ok: true };
    }
    const notificationMatch = pathname.match(/^\/api\/driver\/notifications\/([^/]+)\/read$/);
    if (notificationMatch && method === 'PATCH') {
      const user = requireUser('mototaxista');
      const list = read(keys.notifications, []);
      const index = list.findIndex((item) => item.id === notificationMatch[1] && item.driver_email === user.email);
      if (index < 0) fail(404, 'Notificação não encontrada.');
      list[index] = { ...list[index], read_at: new Date().toISOString() };
      write(keys.notifications, list);
      return { ok: true };
    }
    fail(404, 'Operação local não suportada.');
  };
  const exportReport = (format, kind, from, to) => {
    const user = requireUser('mototaxista');
    let rows = driverRides(user);
    if (kind === 'despesas') rows = read(keys.expenses, []).filter((item) => item.driver_email === user.email);
    if (from) rows = rows.filter((item) => String(item.created_at || item.spent_on).slice(0, 10) >= from);
    if (to) rows = rows.filter((item) => String(item.created_at || item.spent_on).slice(0, 10) <= to);
    const values = rows.map((item) => [
      item.code || '',
      item.created_at || item.spent_on || '',
      item.pickup || item.category || '',
      item.destination || item.description || '',
      item.amount_cents || 0,
      item.status || '',
    ]);
    const headings = ['Código', 'Data', 'Origem/Categoria', 'Destino/Descrição', 'Valor (centavos)', 'Status'];
    const reportRows = [headings, ...values];
    if (format === 'pdf') {
      const escapeHtml = (value) => String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
      const table = reportRows.map((row, index) => (
        `<tr>${row.map((value) => `<${index === 0 ? 'th' : 'td'}>${escapeHtml(value)}</${index === 0 ? 'th' : 'td'}>`).join('')}</tr>`
      )).join('');
      const reportWindow = window.open('', '_blank');
      if (!reportWindow) fail(503, 'Permita a abertura de janelas para imprimir o relatório em PDF.');
      reportWindow.addEventListener('load', () => reportWindow.print(), { once: true });
      reportWindow.document.write(
        `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Relatório Veloz</title>`
        + `<style>body{font:14px Arial,sans-serif;margin:24px}h1{font-size:20px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:8px;text-align:left}th{background:#eee}</style>`
        + `<h1>Relatório Veloz</h1><p>${escapeHtml(kind)} · ${escapeHtml(from || 'início')} a ${escapeHtml(to || 'hoje')}</p><table>${table}</table></html>`,
      );
      reportWindow.document.close();
      return;
    }
    if (format !== 'csv') fail(400, 'Formato de relatório inválido.');
    const csv = reportRows.map((row) => (
      row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(';')
    )).join('\r\n');
    const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    const objectUrl = URL.createObjectURL(blob);
    link.href = objectUrl;
    link.download = `veloz-relatorio-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  };
  window.velozLocalApi = { request, exportReport };
})();
