import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { JwtPayload } from './strategies/jwt.strategy';
import { User } from '../users/entities/user.entity';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly cfg: ConfigService,
  ) {}

  async login(dto: LoginDto): Promise<AuthResponseDto> {
    const user = await this.users.findByEmailOrFail(dto.email).catch(() => null);
    if (!user || !user.isActive) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Credenciales inválidas' });
    }
    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Credenciales inválidas' });
    }
    return this.issueTokens(user);
  }

  async register(dto: RegisterDto): Promise<AuthResponseDto> {
    await this.users.create({
      email: dto.email.toLowerCase().trim(),
      password: dto.password,
      fullName: dto.fullName.trim(),
      role: 'DEVELOPER',
    });
    const user = await this.users.findByEmailOrFail(dto.email.toLowerCase().trim());
    return this.issueTokens(user);
  }

  async refresh(refreshToken: string): Promise<AuthResponseDto> {
    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.cfg.get<string>('JWT_REFRESH_SECRET'),
      });
      const user = await this.users.findByIdOrFail(payload.sub);
      // TODO: Revocación persistida de refresh tokens (tabla refresh_tokens) — sprint 5.
      return this.issueTokens(user);
    } catch {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Refresh token inválido' });
    }
  }

  private async issueTokens(user: User): Promise<AuthResponseDto> {
    const payload: JwtPayload = {
      sub: Number(user.id),
      email: user.email,
      role: user.role,
    };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.cfg.get<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.cfg.get<string>('JWT_ACCESS_EXPIRES_IN', '15m'),
    });
    const refreshToken = await this.jwt.signAsync(payload, {
      secret: this.cfg.get<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.cfg.get<string>('JWT_REFRESH_EXPIRES_IN', '7d'),
    });
    return { accessToken, refreshToken, user: UserResponseDto.from(user) };
  }
}
